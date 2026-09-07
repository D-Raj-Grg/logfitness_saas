-- Check-ins over time. distinct_members is the honest number: one member who
-- trains six times is six check-ins but one person still using the gym, and
-- the second is what tells you whether the branch is growing.
create or replace function public.attendance_trend(
  p_branch_ids uuid[] default null,
  p_from date default null,
  p_to date default null,
  p_group_by text default 'day'
)
returns table (
  period date,
  branch_id uuid,
  branch_name text,
  check_ins bigint,
  distinct_members bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    public.report_period(a.attended_on, p_group_by),
    a.branch_id,
    b.name,
    count(*)::bigint,
    count(distinct a.member_id)::bigint
  from public.attendance a
  join public.branches b on b.id = a.branch_id
  where (p_branch_ids is null or a.branch_id = any(p_branch_ids))
    and a.attended_on >= coalesce(p_from, public.org_today(a.org_id) - 30)
    and a.attended_on <= coalesce(p_to, public.org_today(a.org_id))
  group by 1, 2, 3
  order by 1 desc, 3;
$$;

-- Which plans actually sell. Revenue is what was billed for the membership,
-- joining fee included where it was separated -- not what has been collected;
-- the arrears report answers the collection question.
--
-- share_pct is each plan/branch group's share of ALL active memberships in
-- scope (every branch p_branch_ids allows, summed together) -- not a share
-- restricted to that one row's branch. A caller who filters to several
-- branches gets percentages that sum to 100 across the whole filtered set,
-- not per branch; a caller who wants a single branch's mix passes one branch
-- id and gets exactly that.
create or replace function public.plan_mix(
  p_branch_ids uuid[] default null
)
returns table (
  plan_id uuid,
  plan_name text,
  plan_kind text,
  branch_id uuid,
  branch_name text,
  active_memberships bigint,
  revenue_paisa bigint,
  share_pct numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with active as (
    select
      m.plan_id,
      m.branch_id,
      m.price_paisa,
      coalesce(m.signup_fee_paisa, 0) as signup_fee_paisa
    from public.memberships m
    where m.status = 'active'::public.membership_status
      and (p_branch_ids is null or m.branch_id = any(p_branch_ids))
  ),
  grouped as (
    select
      active.plan_id,
      active.branch_id,
      count(*)::bigint as active_memberships,
      sum(active.price_paisa + active.signup_fee_paisa)::bigint as revenue_paisa
    from active
    group by 1, 2
  )
  select
    grouped.plan_id,
    p.name,
    p.plan_type::text,
    grouped.branch_id,
    b.name,
    grouped.active_memberships,
    grouped.revenue_paisa,
    round(
      100.0 * grouped.active_memberships
        / nullif(sum(grouped.active_memberships) over (), 0),
      1
    )
  from grouped
  join public.membership_plans p on p.id = grouped.plan_id
  join public.branches b on b.id = grouped.branch_id
  order by grouped.active_memberships desc, p.name;
$$;

revoke execute on function public.attendance_trend(uuid[], date, date, text) from public, anon;
revoke execute on function public.plan_mix(uuid[]) from public, anon;

grant execute on function public.attendance_trend(uuid[], date, date, text) to authenticated;
grant execute on function public.plan_mix(uuid[]) to authenticated;
