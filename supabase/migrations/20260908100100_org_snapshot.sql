-- One row per branch plus a totals row, for the HQ dashboard.
--
-- The dashboard previously issued one daily_collection() per branch through
-- Promise.all -- an N+1 that grows with the chain. This is one round trip.
--
-- Reversals are netted out of the day's takings the same way refunds are: the
-- money did not arrive either way. The reports keep them in separate columns,
-- because *why* the drawer is short is the point of a report and not of a tile.
create or replace function public.org_snapshot(
  p_branch_ids uuid[] default null
)
returns table (
  branch_id uuid,
  branch_name text,
  active_members bigint,
  collected_today_paisa bigint,
  check_ins_today bigint,
  expiring_7d bigint,
  dues_paisa bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped_branches as (
    select b.id, b.name, b.org_id
    from public.branches b
    where (p_branch_ids is null or b.id = any(p_branch_ids))
  ),
  members_by_branch as (
    select
      mo.home_branch_id as branch_id,
      count(*) filter (where mo.status = 'active'::public.member_status) as active_members,
      count(*) filter (
        where mo.status = 'active'::public.member_status and mo.days_to_expiry <= 7
      ) as expiring_7d,
      coalesce(sum(mo.due_paisa), 0)::bigint as dues_paisa
    from public.member_overview mo
    where mo.archived_at is null
    group by mo.home_branch_id
  ),
  money_by_branch as (
    select
      p.branch_id,
      coalesce(sum(p.amount_paisa), 0)::bigint as collected_today_paisa
    from public.payments p
    join public.orgs o on o.id = p.org_id
    where (p.paid_at at time zone o.timezone)::date = public.org_today(p.org_id)
    group by p.branch_id
  ),
  visits_by_branch as (
    select
      a.branch_id,
      count(*)::bigint as check_ins_today
    from public.attendance a
    where a.attended_on = public.org_today(a.org_id)
    group by a.branch_id
  ),
  per_branch as (
    select
      sb.id as branch_id,
      sb.name as branch_name,
      coalesce(m.active_members, 0)::bigint as active_members,
      coalesce(mo.collected_today_paisa, 0)::bigint as collected_today_paisa,
      coalesce(v.check_ins_today, 0)::bigint as check_ins_today,
      coalesce(m.expiring_7d, 0)::bigint as expiring_7d,
      coalesce(m.dues_paisa, 0)::bigint as dues_paisa
    from scoped_branches sb
    left join members_by_branch m on m.branch_id = sb.id
    left join money_by_branch mo on mo.branch_id = sb.id
    left join visits_by_branch v on v.branch_id = sb.id
  )
  select * from per_branch
  union all
  select
    null::uuid,
    null::text,
    coalesce(sum(active_members), 0)::bigint,
    coalesce(sum(collected_today_paisa), 0)::bigint,
    coalesce(sum(check_ins_today), 0)::bigint,
    coalesce(sum(expiring_7d), 0)::bigint,
    coalesce(sum(dues_paisa), 0)::bigint
  from per_branch
  order by branch_name nulls first;
$$;

revoke execute on function public.org_snapshot(uuid[]) from public, anon;
grant execute on function public.org_snapshot(uuid[]) to authenticated;
