-- plan_mix counted the joining fee twice.
--
-- renew_membership writes the whole subtotal -- plan price plus every one-off
-- fee -- into memberships.price_paisa, and the fee again into its own memo
-- column. 20260908100500 summed price_paisa + signup_fee_paisa, so every
-- first-time sale was overstated by its fee. Revenue is price_paisa alone; the
-- fee columns say what part of it was a fee, not something on top of it.
-- Unchanged otherwise.
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
      m.price_paisa
    from public.memberships m
    where m.status = 'active'::public.membership_status
      and (p_branch_ids is null or m.branch_id = any(p_branch_ids))
  ),
  grouped as (
    select
      active.plan_id,
      active.branch_id,
      count(*)::bigint as active_memberships,
      sum(active.price_paisa)::bigint as revenue_paisa
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

revoke execute on function public.plan_mix(uuid[]) from public, anon;
grant execute on function public.plan_mix(uuid[]) to authenticated;
