-- Everything the front desk and the reports read. Same shape as the Phase 1
-- reports: one view for the raw log, plain SQL functions for the two questions
-- a branch actually asks — who is in the building, and who has stopped coming.

-- The visit log with the names filled in. security_invoker keeps RLS on the
-- underlying tables in force for whoever selects from it.
create or replace view public.attendance_detail
with (security_invoker = true)
as
select
  a.id,
  a.org_id,
  a.branch_id,
  b.name as branch_name,
  a.member_id,
  m.member_code,
  m.full_name,
  m.phone,
  m.photo_path,
  a.membership_id,
  a.method,
  a.checked_in_at,
  a.checked_out_at,
  a.attended_on,
  a.membership_status_at_checkin,
  a.days_to_expiry_at_checkin,
  a.due_paisa_at_checkin,
  a.is_override,
  a.override_reason,
  a.checked_in_by,
  s.full_name as checked_in_by_name,
  a.notes
from public.attendance a
join public.branches b on b.id = a.branch_id
join public.members m on m.id = a.member_id
left join public.staff s on s.id = a.checked_in_by;

-- Who is in the building right now. "Now" is the gym's own day, so a visit left
-- open overnight drops off the board instead of inflating it forever.
create or replace function public.in_gym_now(p_branch_id uuid default null)
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
    and (p_branch_id is null or d.branch_id = p_branch_id)
  order by d.checked_in_at desc;
$$;

-- Churn early warning. An active member who has not walked in for a fortnight is
-- the one to call before the renewal date, not after it. Members who never came
-- at all are measured from the day they joined, which is the worst case and the
-- one most worth a phone call.
create or replace function public.absent_members(
  p_branch_id uuid default null,
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
      and (p_branch_id is null or mo.home_branch_id = p_branch_id)
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

-- Branch-day roll-up for the check-in screen header and, later, the HQ tiles.
create or replace function public.attendance_day_summary(
  p_on date default null,
  p_branch_id uuid default null
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
    and (p_branch_id is null or d.branch_id = p_branch_id)
  group by d.branch_id, d.branch_name, d.attended_on
  order by d.branch_name;
$$;

revoke execute on function public.in_gym_now(uuid) from public, anon;
revoke execute on function public.absent_members(uuid, integer) from public, anon;
revoke execute on function public.attendance_day_summary(date, uuid) from public, anon;

grant execute on function public.in_gym_now(uuid) to authenticated;
grant execute on function public.absent_members(uuid, integer) to authenticated;
grant execute on function public.attendance_day_summary(date, uuid) to authenticated;

revoke all on public.attendance_detail from public, anon;
grant select on public.attendance_detail to authenticated;
