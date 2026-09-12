-- A visitor's phone number can be shorter than an address is allowed to be.
--
-- Caught by supabase/tests/visitor_messages.sql on the same afternoon the
-- previous migration shipped. `visitors.phone` accepts 1 to 30 characters --
-- the desk types what it was given -- while `notification_messages.to_address`
-- carries a CHECK of 3 to 254. Somebody logged as "12" therefore produced a
-- CHECK violation inside the welcome trigger, which the trigger's own handler
-- swallowed: no row, no warning on screen, and a walk-in the log claimed had
-- never been texted for a reason nobody could see.
--
-- The fallback is now 'unknown' whenever the raw number would not fit, so the
-- `skipped` row exists and says why. The sweep gets the same treatment; it had
-- the same hole with no handler above it, where the failure would have taken
-- the whole night's follow-ups down rather than one row.

create or replace function public.enqueue_visitor_welcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  tpl record;
  v_vars jsonb;
  v_address text;
  v_body text;
begin
  begin
    select
      o.id as org_id, o.name as org_name,
      b.name as branch_name,
      p.name as plan_name,
      rule.channel
      into r
      from public.notification_rules rule
      join public.orgs o on o.id = rule.org_id
      left join public.branches b on b.id = new.branch_id and b.org_id = o.id
      left join public.membership_plans p
             on p.id = new.interested_plan_id and p.org_id = o.id
     where rule.org_id = new.org_id
       and rule.event = 'visitor_welcome'::public.notification_event
       and rule.enabled
     limit 1;

    if not found then
      return new;
    end if;

    if not exists (
      select 1 from public.notification_providers np
      where np.org_id = r.org_id and np.channel = r.channel and np.is_active
    ) then
      return new;
    end if;

    v_vars := jsonb_build_object(
      'visitor_name', new.full_name,
      'name',         new.full_name,
      'gym_name',     r.org_name,
      'branch_name',  coalesce(r.branch_name, r.org_name),
      'plan_name',    coalesce(r.plan_name, ''),
      'visited_on',   to_char(new.visited_on, 'DD Mon YYYY')
    );

    select * into tpl
      from public.resolve_notification_template(
        r.org_id, 'visitor_welcome'::public.notification_event, r.channel,
        public.org_notification_locale(r.org_id));

    v_body := public.render_notification_template(tpl.body, v_vars);
    if v_body is null or length(btrim(v_body)) = 0 then
      return new;
    end if;

    v_address := case r.channel
                   when 'email' then null
                   else public.normalise_msisdn(new.phone)
                 end;

    insert into public.notification_messages (
      org_id, branch_id, visitor_id, channel, event, to_address, subject, body,
      status, last_error, dedupe_key
    )
    values (
      r.org_id, new.branch_id, new.id, r.channel, 'visitor_welcome',
      -- What the desk actually had on file, unless it is too short to store --
      -- then the row still exists and the error says what happened.
      case
        when v_address is not null then v_address
        when length(btrim(coalesce(new.phone, ''))) >= 3 then btrim(new.phone)
        else 'unknown'
      end,
      public.render_notification_template(tpl.subject, v_vars),
      left(btrim(v_body), 1000),
      case when v_address is null then 'skipped'::public.notification_status
           else 'queued'::public.notification_status end,
      case when v_address is null
           then 'No usable ' || r.channel::text || ' address for this visitor' end,
      'visitor_welcome:' || new.id::text
    )
    on conflict (org_id, dedupe_key) do nothing;
  exception
    when others then
      raise warning 'visitor welcome not queued for %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke execute on function public.enqueue_visitor_welcome() from public, anon, authenticated;

create or replace function public.enqueue_visitor_follow_ups()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  with candidate as (
    select
      rule.channel, rule.send_at_local, rule.offset_days,
      o.id as org_id, o.name as org_name, o.timezone,
      public.org_today(o.id) as today,
      v.id as visitor_id, v.full_name, v.phone, v.branch_id,
      b.name as branch_name,
      p.name as plan_name
    from public.notification_rules rule
    join public.orgs o on o.id = rule.org_id
    join public.visitors v on v.org_id = o.id
    left join public.branches b on b.id = v.branch_id and b.org_id = o.id
    left join public.membership_plans p on p.id = v.interested_plan_id and p.org_id = o.id
    where rule.event = 'visitor_follow_up'
      and rule.enabled
      and v.visited_on = public.org_today(o.id) - rule.offset_days
      and v.status in ('new'::public.visitor_status, 'contacted'::public.visitor_status)
      and exists (
        select 1 from public.notification_providers np
        where np.org_id = o.id and np.channel = rule.channel and np.is_active
      )
  ),
  rendered as (
    select
      c.*,
      tpl.subject as tpl_subject,
      tpl.body    as tpl_body,
      jsonb_build_object(
        'visitor_name', c.full_name,
        'name',         c.full_name,
        'gym_name',     c.org_name,
        'branch_name',  coalesce(c.branch_name, c.org_name),
        'plan_name',    coalesce(c.plan_name, ''),
        'visited_on',   to_char(c.today - c.offset_days, 'DD Mon YYYY')
      ) as vars,
      case c.channel
        when 'email' then null
        else public.normalise_msisdn(c.phone)
      end as usable_address
    from candidate c
    cross join lateral public.resolve_notification_template(
      c.org_id, 'visitor_follow_up'::public.notification_event, c.channel,
      public.org_notification_locale(c.org_id)
    ) tpl
  )
  insert into public.notification_messages (
    org_id, branch_id, visitor_id, channel, event, to_address, subject, body,
    status, last_error, scheduled_for, next_attempt_at, dedupe_key
  )
  select
    r.org_id, r.branch_id, r.visitor_id, r.channel, 'visitor_follow_up',
    case
      when r.usable_address is not null then r.usable_address
      when length(btrim(coalesce(r.phone, ''))) >= 3 then btrim(r.phone)
      else 'unknown'
    end,
    public.render_notification_template(r.tpl_subject, r.vars),
    public.render_notification_template(r.tpl_body, r.vars),
    case when r.usable_address is null then 'skipped'::public.notification_status
         else 'queued'::public.notification_status end,
    case when r.usable_address is null
         then 'No usable ' || r.channel::text || ' address for this visitor' end,
    (r.today + r.send_at_local) at time zone coalesce(r.timezone, 'Asia/Kathmandu'),
    (r.today + r.send_at_local) at time zone coalesce(r.timezone, 'Asia/Kathmandu'),
    'visitor_follow_up:' || r.visitor_id::text
  from rendered r
  on conflict (org_id, dedupe_key) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.enqueue_visitor_follow_ups() from public, anon, authenticated;
