-- A manager runs more than one branch, so a report has to answer for a set of
-- them. The scalar p_branch_id could not express a union; an array can, and
-- null keeps its old meaning of "every branch RLS allows".
--
-- The old signatures are dropped rather than kept alongside: two signatures
-- that both default their only branch argument make a no-argument call
-- ambiguous, and every caller is in this repo.

drop function if exists public.daily_collection(date, uuid);
drop function if exists public.arrears_report(uuid);
drop function if exists public.in_gym_now(uuid);
drop function if exists public.absent_members(uuid, integer);
drop function if exists public.attendance_day_summary(date, uuid);

create or replace function public.daily_collection(
  p_on date default null,
  p_branch_ids uuid[] default null
)
returns table (
  branch_id uuid,
  branch_name text,
  staff_id uuid,
  staff_name text,
  method public.payment_method,
  kind public.payment_kind,
  txn_count bigint,
  amount_paisa bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.branch_id,
    b.name,
    p.collected_by,
    coalesce(s.full_name, 'Removed staff'),
    p.method,
    p.kind,
    count(*),
    sum(p.amount_paisa)
  from public.payments p
  join public.branches b on b.id = p.branch_id
  join public.orgs o on o.id = p.org_id
  left join public.staff s on s.id = p.collected_by
  where (p_branch_ids is null or p.branch_id = any(p_branch_ids))
    -- The business day is the org's day, not UTC's. A 10pm payment in Kathmandu
    -- belongs to that evening's drawer, not to tomorrow's.
    and (p.paid_at at time zone o.timezone)::date
        = coalesce(p_on, public.org_today(p.org_id))
  group by p.branch_id, b.name, p.collected_by, s.full_name, p.method, p.kind
  order by b.name, coalesce(s.full_name, 'Removed staff'), p.method;
$$;

create or replace function public.arrears_report(
  p_branch_ids uuid[] default null
)
returns table (
  member_id uuid,
  member_code text,
  full_name text,
  phone text,
  home_branch_id uuid,
  home_branch_name text,
  due_paisa bigint,
  oldest_due_on date,
  age_days integer,
  bucket text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    o.id,
    o.member_code,
    o.full_name,
    o.phone,
    o.home_branch_id,
    o.home_branch_name,
    o.due_paisa,
    o.oldest_due_on,
    (public.org_today(o.org_id) - o.oldest_due_on)::integer as age_days,
    case
      when public.org_today(o.org_id) - o.oldest_due_on <= 30 then '0-30'
      when public.org_today(o.org_id) - o.oldest_due_on <= 60 then '31-60'
      when public.org_today(o.org_id) - o.oldest_due_on <= 90 then '61-90'
      else '90+'
    end as bucket
  from public.member_overview o
  where o.due_paisa > 0
    and (p_branch_ids is null or o.home_branch_id = any(p_branch_ids))
  order by o.oldest_due_on, o.due_paisa desc;
$$;

create or replace function public.in_gym_now(
  p_branch_ids uuid[] default null
)
returns table (
  attendance_id uuid,
  member_id uuid,
  member_code text,
  full_name text,
  phone text,
  photo_path text,
  branch_id uuid,
  branch_name text,
  checked_in_at timestamptz,
  minutes_in integer,
  membership_status public.membership_status,
  days_to_expiry integer,
  due_paisa bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    d.id,
    d.member_id,
    d.member_code,
    d.full_name,
    d.phone,
    d.photo_path,
    d.branch_id,
    d.branch_name,
    d.checked_in_at,
    (extract(epoch from (now() - d.checked_in_at)) / 60)::integer,
    d.membership_status_at_checkin,
    d.days_to_expiry_at_checkin,
    d.due_paisa_at_checkin
  from public.attendance_detail d
  where d.checked_out_at is null
    and d.attended_on = public.org_today(d.org_id)
    and (p_branch_ids is null or d.branch_id = any(p_branch_ids))
  order by d.checked_in_at desc;
$$;

create or replace function public.absent_members(
  p_branch_ids uuid[] default null,
  p_min_days integer default 14
)
returns table (
  member_id uuid,
  member_code text,
  full_name text,
  phone text,
  home_branch_id uuid,
  home_branch_name text,
  membership_end_date date,
  days_to_expiry integer,
  due_paisa bigint,
  last_seen_on date,
  days_absent integer,
  ever_visited boolean,
  band text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with seen as (
    select
      mo.id,
      mo.org_id,
      mo.member_code,
      mo.full_name,
      mo.phone,
      mo.home_branch_id,
      mo.home_branch_name,
      mo.membership_end_date,
      mo.days_to_expiry,
      mo.due_paisa,
      mo.joined_on,
      last_visit.attended_on as last_seen_on
    from public.member_overview mo
    left join lateral (
      select max(a.attended_on) as attended_on
      from public.attendance a
      where a.member_id = mo.id
    ) last_visit on true
    where mo.status = 'active'::public.member_status
      and mo.archived_at is null
      and (p_branch_ids is null or mo.home_branch_id = any(p_branch_ids))
  ),
  measured as (
    select
      seen.*,
      (public.org_today(seen.org_id)
        - coalesce(seen.last_seen_on, seen.joined_on))::integer as days_absent
    from seen
  )
  select
    measured.id,
    measured.member_code,
    measured.full_name,
    measured.phone,
    measured.home_branch_id,
    measured.home_branch_name,
    measured.membership_end_date,
    measured.days_to_expiry,
    measured.due_paisa::bigint,
    measured.last_seen_on,
    measured.days_absent,
    measured.last_seen_on is not null,
    case
      when measured.days_absent >= 60 then '60+ days'
      when measured.days_absent >= 30 then '30-59 days'
      else '14-29 days'
    end
  from measured
  where measured.days_absent >= greatest(coalesce(p_min_days, 14), 1)
  order by measured.days_absent desc, measured.full_name;
$$;

create or replace function public.attendance_day_summary(
  p_on date default null,
  p_branch_ids uuid[] default null
)
returns table (
  branch_id uuid,
  branch_name text,
  attended_on date,
  check_ins bigint,
  distinct_members bigint,
  in_gym_now bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    d.branch_id,
    d.branch_name,
    d.attended_on,
    count(*),
    count(distinct d.member_id),
    count(*) filter (
      where d.checked_out_at is null
        and d.attended_on = public.org_today(d.org_id)
    )
  from public.attendance_detail d
  where d.attended_on = coalesce(p_on, public.org_today(d.org_id))
    and (p_branch_ids is null or d.branch_id = any(p_branch_ids))
  group by d.branch_id, d.branch_name, d.attended_on
  order by d.branch_name;
$$;

revoke execute on function public.daily_collection(date, uuid[]) from public, anon;
revoke execute on function public.arrears_report(uuid[]) from public, anon;
revoke execute on function public.in_gym_now(uuid[]) from public, anon;
revoke execute on function public.absent_members(uuid[], integer) from public, anon;
revoke execute on function public.attendance_day_summary(date, uuid[]) from public, anon;

grant execute on function public.daily_collection(date, uuid[]) to authenticated;
grant execute on function public.arrears_report(uuid[]) to authenticated;
grant execute on function public.in_gym_now(uuid[]) to authenticated;
grant execute on function public.absent_members(uuid[], integer) to authenticated;
grant execute on function public.attendance_day_summary(date, uuid[]) to authenticated;
