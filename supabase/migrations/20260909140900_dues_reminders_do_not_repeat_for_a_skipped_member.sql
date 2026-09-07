-- Two defects found reviewing the Phase 5 work, both in the same area: what
-- happens to a member the gym cannot actually reach.
--
-- 1. THE DUES SWEEP WROTE A ROW A DAY, FOREVER, for a member with an
--    outstanding balance and a phone number that will not normalise. The
--    cadence guard ("do not chase again inside repeat_after_days") counted only
--    `queued`, `sending` and `sent`, and the dedupe key carries the date, so a
--    `skipped` row suppressed nothing and the next night wrote another one.
--    Verified: two rows after two simulated days, and no reason it would ever
--    stop. This is exactly the row explosion the design claims to avoid by
--    skipping an org with no gateway -- the same trap one level down, at the
--    member. `skipped` now counts towards the cadence, so an unreachable member
--    produces one row per cadence window; if their number is corrected, the
--    next window picks them up normally.
--
-- 2. A subject rendered from a null template came out as the empty string
--    rather than null, so every SMS carried `subject = ''`. Invisible today --
--    the log renders it falsily and no SMS adapter reads a subject -- but it is
--    a lie in the column, and the first `coalesce(subject, 'something')` on the
--    email path would pick '' over the fallback. Fixed centrally in
--    `render_notification_template`: nothing in, nothing out. A null body would
--    now fail the NOT NULL on `notification_messages.body` loudly, which is the
--    right outcome for a template that does not exist.

create or replace function public.render_notification_template(
  p_body text,
  p_vars jsonb
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out text;
  v_key text;
  v_val text;
begin
  -- Nothing in, nothing out. A message with no subject must hold null, not ''.
  if p_body is null then
    return null;
  end if;

  v_out := p_body;

  if p_vars is not null and jsonb_typeof(p_vars) = 'object' then
    for v_key, v_val in select key, value from jsonb_each_text(p_vars) loop
      v_out := replace(v_out, '{{' || v_key || '}}', coalesce(v_val, ''));
    end loop;
  end if;

  -- A placeholder nobody supplied is dropped rather than sent. "Your {{plan_name}}
  -- expires" reaching a member is worse than "Your  expires" never being written,
  -- and the gate asserts the built-in templates never leave one behind.
  v_out := regexp_replace(v_out, '\{\{[a-z_]+\}\}', '', 'g');
  v_out := btrim(regexp_replace(v_out, '[ ]{2,}', ' ', 'g'));

  return left(v_out, 1000);
end;
$$;

revoke execute on function public.render_notification_template(text, jsonb) from public, anon;
grant execute on function public.render_notification_template(text, jsonb) to authenticated;

create or replace function public.enqueue_dues_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  with debt as (
    -- One message per member, not one per unpaid invoice. A member with three
    -- part-paid renewals owes one sum and should be asked once.
    select
      i.org_id,
      i.member_id,
      sum(i.due_paisa)::bigint as due_paisa,
      min(i.issued_on) as oldest_due_on,
      (array_agg(i.branch_id order by i.issued_on desc))[1] as branch_id
    from public.invoices i
    where i.due_paisa > 0
    group by i.org_id, i.member_id
  ),
  candidate as (
    select
      r.channel, r.send_at_local, r.offset_days, r.repeat_after_days,
      o.id as org_id, o.name as org_name, o.timezone, o.currency,
      public.org_today(o.id) as today,
      m.id as member_id, m.full_name, m.phone, m.email,
      d.due_paisa, d.oldest_due_on, d.branch_id,
      b.name as branch_name
    from public.notification_rules r
    join public.orgs o on o.id = r.org_id
    join debt d on d.org_id = o.id
    join public.members m on m.id = d.member_id
    left join public.branches b on b.id = d.branch_id
    where r.event = 'dues_reminder'
      and r.enabled
      and d.due_paisa >= r.min_amount_paisa
      and d.oldest_due_on <= public.org_today(o.id) - r.offset_days
      and m.archived_at is null
      and not m.notifications_opt_out
      and m.status <> 'left'::public.member_status
      and exists (
        select 1 from public.notification_providers np
        where np.org_id = o.id and np.channel = r.channel and np.is_active
      )
      -- Chasing is a cadence, not a daily habit. `skipped` counts: a member
      -- whose number will not normalise is not reachable today and will not be
      -- reachable tomorrow either, and without this the sweep writes them a row
      -- every single night for ever.
      and not exists (
        select 1 from public.notification_messages nm
        where nm.org_id = o.id
          and nm.member_id = m.id
          and nm.event = 'dues_reminder'
          and nm.status in ('queued'::public.notification_status,
                            'sending'::public.notification_status,
                            'sent'::public.notification_status,
                            'skipped'::public.notification_status)
          and nm.created_at > now() - make_interval(days => r.repeat_after_days)
      )
  ),
  rendered as (
    select
      c.*,
      tpl.subject as tpl_subject,
      tpl.body    as tpl_body,
      jsonb_build_object(
        'member_name', c.full_name,
        'name',        c.full_name,
        'gym_name',    c.org_name,
        'branch_name', coalesce(c.branch_name, c.org_name),
        'due_amount',  public.format_paisa(c.due_paisa, coalesce(c.currency, 'NPR')),
        'end_date',    to_char(c.oldest_due_on, 'DD Mon YYYY'),
        'email',       coalesce(c.email, '')
      ) as vars,
      case c.channel
        when 'email' then lower(nullif(btrim(c.email), ''))
        else public.normalise_msisdn(c.phone)
      end as usable_address
    from candidate c
    cross join lateral public.resolve_notification_template(
      c.org_id, 'dues_reminder'::public.notification_event, c.channel,
      public.org_notification_locale(c.org_id)
    ) tpl
  )
  insert into public.notification_messages (
    org_id, branch_id, member_id, channel, event, to_address, subject, body,
    status, last_error, scheduled_for, next_attempt_at, dedupe_key
  )
  select
    r.org_id, r.branch_id, r.member_id, r.channel, 'dues_reminder',
    coalesce(r.usable_address, btrim(coalesce(r.phone, r.email, 'unknown'))),
    public.render_notification_template(r.tpl_subject, r.vars),
    public.render_notification_template(r.tpl_body, r.vars),
    case when r.usable_address is null then 'skipped'::public.notification_status
         else 'queued'::public.notification_status end,
    case when r.usable_address is null
         then 'No usable ' || r.channel::text || ' address for this member' end,
    (r.today + r.send_at_local) at time zone coalesce(r.timezone, 'Asia/Kathmandu'),
    (r.today + r.send_at_local) at time zone coalesce(r.timezone, 'Asia/Kathmandu'),
    'dues:' || r.member_id::text || ':' || r.today::text
  from rendered r
  on conflict (org_id, dedupe_key) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.enqueue_dues_reminders() from public, anon, authenticated;
