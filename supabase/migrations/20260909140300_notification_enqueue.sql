-- Phase 5, part 4 of 6: deciding who gets told what, once a day.
--
-- Four set-based jobs, no row loops, in the shape `sweep_membership_expiry`
-- already set: one global pg_cron schedule in UTC, per-org date correctness
-- from `org_today(org_id)` inside the function.
--
-- Idempotency is the `(org_id, dedupe_key)` unique constraint plus
-- `on conflict do nothing`, so running a job twice inserts once. That matters
-- more here than anywhere else in the codebase: the cost of a bug is a member
-- receiving the same text four times, which is the thing that makes a gym turn
-- reminders off.
--
-- An org with no active gateway on a channel is skipped entirely rather than
-- accumulating `skipped` rows. A chain with a thousand members in arrears would
-- otherwise write a thousand rows a day saying "there is no gateway", which
-- buries the rows that mean something. The settings screen says it once
-- instead.

create or replace function public.org_notification_locale(p_org_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    case when o.settings ->> 'notification_locale' in ('en', 'ne')
         then o.settings ->> 'notification_locale' end,
    'en')
  from public.orgs o where o.id = p_org_id;
$$;

-- Default rules for a new org: remind at T-7 and T-1, chase a debt three days
-- old and again no more than weekly, and wish a happy birthday. All by SMS,
-- all enabled -- but nothing is sent until a gateway exists, so "enabled" here
-- means "on the day you configure Sparrow, this starts working" rather than
-- "this is already texting people".
create or replace function public.seed_notification_rules(p_org_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notification_rules (org_id, event, channel, enabled, offset_days, min_amount_paisa, repeat_after_days)
  values
    (p_org_id, 'renewal_reminder',  'sms', true, 7, 0, 7),
    (p_org_id, 'renewal_reminder',  'sms', true, 1, 0, 7),
    (p_org_id, 'dues_reminder',     'sms', true, 3, 0, 7),
    (p_org_id, 'birthday_greeting', 'sms', true, 0, 0, 7)
  on conflict (org_id, event, channel, offset_days) do nothing;
$$;

create or replace function public.seed_notification_rules_for_new_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_notification_rules(new.id);
  return new;
end;
$$;

create trigger orgs_seed_notification_rules
  after insert on public.orgs
  for each row execute function public.seed_notification_rules_for_new_org();

select public.seed_notification_rules(o.id) from public.orgs o;

-- ---------------------------------------------------------------------------
-- renewal reminders
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_renewal_reminders()
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
      r.channel,
      r.offset_days,
      r.send_at_local,
      o.id   as org_id,
      o.name as org_name,
      o.timezone,
      o.currency,
      public.org_today(o.id) as today,
      m.id   as member_id,
      m.full_name,
      m.phone,
      m.email,
      ms.id  as membership_id,
      ms.branch_id,
      ms.plan_name,
      ms.end_date,
      b.name as branch_name
    from public.notification_rules r
    join public.orgs o on o.id = r.org_id
    join public.memberships ms on ms.org_id = o.id
    join public.members m on m.id = ms.member_id
    left join public.branches b on b.id = ms.branch_id
    where r.event = 'renewal_reminder'
      and r.enabled
      and ms.status = 'active'
      and ms.end_date = public.org_today(o.id) + r.offset_days
      and m.archived_at is null
      and not m.notifications_opt_out
      and m.status <> 'left'::public.member_status
      -- Someone who has already renewed is not expiring. Their old membership
      -- still ends on the reminder date; a later one covers them.
      and not exists (
        select 1 from public.memberships ms2
        where ms2.member_id = m.id
          and ms2.status in ('active'::public.membership_status, 'upcoming'::public.membership_status)
          and ms2.end_date > ms.end_date
      )
      and exists (
        select 1 from public.notification_providers np
        where np.org_id = o.id and np.channel = r.channel and np.is_active
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
        'plan_name',   c.plan_name,
        'end_date',    to_char(c.end_date, 'DD Mon YYYY'),
        'days_left',   c.offset_days::text,
        'email',       coalesce(c.email, '')
      ) as vars,
      case c.channel
        when 'email' then lower(nullif(btrim(c.email), ''))
        else public.normalise_msisdn(c.phone)
      end as usable_address
    from candidate c
    cross join lateral public.resolve_notification_template(
      c.org_id, 'renewal_reminder'::public.notification_event, c.channel,
      public.org_notification_locale(c.org_id)
    ) tpl
  )
  insert into public.notification_messages (
    org_id, branch_id, member_id, channel, event, to_address, subject, body,
    status, last_error, scheduled_for, next_attempt_at, dedupe_key
  )
  select
    r.org_id,
    r.branch_id,
    r.member_id,
    r.channel,
    'renewal_reminder',
    coalesce(r.usable_address, btrim(coalesce(r.phone, r.email, 'unknown'))),
    public.render_notification_template(r.tpl_subject, r.vars),
    public.render_notification_template(r.tpl_body, r.vars),
    case when r.usable_address is null then 'skipped'::public.notification_status
         else 'queued'::public.notification_status end,
    case when r.usable_address is null
         then 'No usable ' || r.channel::text || ' address for this member' end,
    (r.today + r.send_at_local) at time zone coalesce(r.timezone, 'Asia/Kathmandu'),
    (r.today + r.send_at_local) at time zone coalesce(r.timezone, 'Asia/Kathmandu'),
    'renewal:' || r.membership_id::text || ':' || r.offset_days::text
  from rendered r
  on conflict (org_id, dedupe_key) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- dues reminders
-- ---------------------------------------------------------------------------

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
      -- Chasing is a cadence, not a daily habit.
      and not exists (
        select 1 from public.notification_messages nm
        where nm.org_id = o.id
          and nm.member_id = m.id
          and nm.event = 'dues_reminder'
          and nm.status in ('queued'::public.notification_status,
                            'sending'::public.notification_status,
                            'sent'::public.notification_status)
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

-- ---------------------------------------------------------------------------
-- birthday greetings
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_birthday_greetings()
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
      r.channel, r.send_at_local,
      o.id as org_id, o.name as org_name, o.timezone,
      public.org_today(o.id) as today,
      m.id as member_id, m.full_name, m.phone, m.email, m.home_branch_id,
      b.name as branch_name
    from public.notification_rules r
    join public.orgs o on o.id = r.org_id
    join public.members m on m.org_id = o.id
    left join public.branches b on b.id = m.home_branch_id
    where r.event = 'birthday_greeting'
      and r.enabled
      and m.date_of_birth is not null
      and extract(month from m.date_of_birth) = extract(month from public.org_today(o.id))
      and extract(day   from m.date_of_birth) = extract(day   from public.org_today(o.id))
      and m.archived_at is null
      and not m.notifications_opt_out
      and m.status <> 'left'::public.member_status
      and exists (
        select 1 from public.notification_providers np
        where np.org_id = o.id and np.channel = r.channel and np.is_active
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
        'email',       coalesce(c.email, '')
      ) as vars,
      case c.channel
        when 'email' then lower(nullif(btrim(c.email), ''))
        else public.normalise_msisdn(c.phone)
      end as usable_address
    from candidate c
    cross join lateral public.resolve_notification_template(
      c.org_id, 'birthday_greeting'::public.notification_event, c.channel,
      public.org_notification_locale(c.org_id)
    ) tpl
  )
  insert into public.notification_messages (
    org_id, branch_id, member_id, channel, event, to_address, subject, body,
    status, last_error, scheduled_for, next_attempt_at, dedupe_key
  )
  select
    r.org_id, r.home_branch_id, r.member_id, r.channel, 'birthday_greeting',
    coalesce(r.usable_address, btrim(coalesce(r.phone, r.email, 'unknown'))),
    public.render_notification_template(r.tpl_subject, r.vars),
    public.render_notification_template(r.tpl_body, r.vars),
    case when r.usable_address is null then 'skipped'::public.notification_status
         else 'queued'::public.notification_status end,
    case when r.usable_address is null
         then 'No usable ' || r.channel::text || ' address for this member' end,
    (r.today + r.send_at_local) at time zone coalesce(r.timezone, 'Asia/Kathmandu'),
    (r.today + r.send_at_local) at time zone coalesce(r.timezone, 'Asia/Kathmandu'),
    'birthday:' || r.member_id::text || ':' || extract(year from r.today)::text
  from rendered r
  on conflict (org_id, dedupe_key) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.enqueue_notifications()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_renewal integer;
  v_dues integer;
  v_birthday integer;
begin
  v_renewal  := public.enqueue_renewal_reminders();
  v_dues     := public.enqueue_dues_reminders();
  v_birthday := public.enqueue_birthday_greetings();

  return jsonb_build_object(
    'renewal_reminder',  v_renewal,
    'dues_reminder',     v_dues,
    'birthday_greeting', v_birthday
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- one message, on purpose: the test send and the staff invitation
-- ---------------------------------------------------------------------------
--
-- Definer rather than invoker, unlike the member-spine RPCs. Those work
-- invoker-mode because staff hold direct insert policies on the tables they
-- write; `notification_messages` deliberately has none for anyone, so an
-- invoker-mode function would have nothing to write through. Every check RLS
-- would have made is therefore made here by hand, the same reasoning as
-- `book_class_session`.
create or replace function public.enqueue_notification(
  p_channel public.notification_channel,
  p_event public.notification_event,
  p_to text,
  p_body text,
  p_subject text default null,
  p_member_id uuid default null,
  p_staff_id uuid default null,
  p_branch_id uuid default null,
  p_dedupe_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.jwt_org_id();
  v_actor uuid := public.jwt_staff_id();
  v_address text;
  v_id uuid;
begin
  if v_org is null or v_actor is null or not public.jwt_is_staff() then
    raise exception 'Only staff can send a message'
      using errcode = 'insufficient_privilege';
  end if;

  if p_branch_id is not null and not public.has_branch_access(p_branch_id) then
    raise exception 'That branch is outside your access'
      using errcode = 'insufficient_privilege';
  end if;

  if p_member_id is not null and not exists (
    select 1 from public.members m where m.id = p_member_id and m.org_id = v_org
  ) then
    raise exception 'That member is not in your gym'
      using errcode = 'no_data_found';
  end if;

  if p_staff_id is not null and not exists (
    select 1 from public.staff s where s.id = p_staff_id and s.org_id = v_org
  ) then
    raise exception 'That staff member is not in your gym'
      using errcode = 'no_data_found';
  end if;

  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'The message cannot be blank'
      using errcode = 'check_violation';
  end if;

  v_address := case p_channel
                 when 'email' then lower(nullif(btrim(p_to), ''))
                 else public.normalise_msisdn(p_to)
               end;

  insert into public.notification_messages (
    org_id, branch_id, member_id, staff_id, channel, event, to_address,
    subject, body, status, last_error, dedupe_key
  )
  values (
    v_org, p_branch_id, p_member_id, p_staff_id, p_channel, p_event,
    coalesce(v_address, btrim(coalesce(p_to, 'unknown'))),
    nullif(btrim(coalesce(p_subject, '')), ''),
    left(btrim(p_body), 1000),
    case when v_address is null then 'skipped'::public.notification_status
         else 'queued'::public.notification_status end,
    case when v_address is null
         then 'No usable ' || p_channel::text || ' address' end,
    coalesce(nullif(btrim(coalesce(p_dedupe_key, '')), ''),
             'manual:' || gen_random_uuid()::text)
  )
  on conflict (org_id, dedupe_key) do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'That message has already been queued'
      using errcode = 'unique_violation';
  end if;

  return v_id;
end;
$$;

-- Cancel a queued message, or push a failed one back into the queue. Owner or
-- the branch's manager: the person who can undo a send is not the person who
-- triggered it, the same split `reverse_payment` draws.
create or replace function public.retry_notification(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.notification_messages;
begin
  select * into v_row from public.notification_messages where id = p_id;

  if v_row.id is null or not public.is_org_member(v_row.org_id) or not public.jwt_is_staff() then
    raise exception 'That message does not exist'
      using errcode = 'no_data_found';
  end if;

  if not (public.jwt_is_owner()
          or (public.jwt_staff_role() = 'manager'::public.staff_role
              and (v_row.branch_id is null or public.has_branch_access(v_row.branch_id)))) then
    raise exception 'Only an owner or the branch manager can resend a message'
      using errcode = 'insufficient_privilege';
  end if;

  if v_row.status not in ('failed'::public.notification_status,
                          'cancelled'::public.notification_status,
                          'skipped'::public.notification_status) then
    raise exception 'Only a failed, cancelled or skipped message can be sent again'
      using errcode = 'check_violation';
  end if;

  update public.notification_messages
     set status = 'queued',
         attempts = 0,
         next_attempt_at = now(),
         request_id = null,
         provider_status = null,
         last_error = null
   where id = p_id;
end;
$$;

create or replace function public.cancel_notification(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.notification_messages;
begin
  select * into v_row from public.notification_messages where id = p_id;

  if v_row.id is null or not public.is_org_member(v_row.org_id) or not public.jwt_is_staff() then
    raise exception 'That message does not exist'
      using errcode = 'no_data_found';
  end if;

  if not (public.jwt_is_owner()
          or (public.jwt_staff_role() = 'manager'::public.staff_role
              and (v_row.branch_id is null or public.has_branch_access(v_row.branch_id)))) then
    raise exception 'Only an owner or the branch manager can cancel a message'
      using errcode = 'insufficient_privilege';
  end if;

  if v_row.status <> 'queued'::public.notification_status then
    raise exception 'Only a message that has not gone out yet can be cancelled'
      using errcode = 'check_violation';
  end if;

  update public.notification_messages
     set status = 'cancelled', last_error = 'Cancelled from the console'
   where id = p_id;
end;
$$;

-- Cron-only. The console never enqueues a sweep.
revoke execute on function public.enqueue_renewal_reminders() from public, anon, authenticated;
revoke execute on function public.enqueue_dues_reminders() from public, anon, authenticated;
revoke execute on function public.enqueue_birthday_greetings() from public, anon, authenticated;
revoke execute on function public.enqueue_notifications() from public, anon, authenticated;
revoke execute on function public.seed_notification_rules(uuid) from public, anon, authenticated;

revoke execute on function public.org_notification_locale(uuid) from public, anon;
grant execute on function public.org_notification_locale(uuid) to authenticated;

revoke execute on function public.enqueue_notification(public.notification_channel, public.notification_event, text, text, text, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.enqueue_notification(public.notification_channel, public.notification_event, text, text, text, uuid, uuid, uuid, text) to authenticated;

revoke execute on function public.retry_notification(uuid) from public, anon;
grant execute on function public.retry_notification(uuid) to authenticated;

revoke execute on function public.cancel_notification(uuid) from public, anon;
grant execute on function public.cancel_notification(uuid) to authenticated;
