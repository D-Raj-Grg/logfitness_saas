-- Two review findings against membership_movement (revenue_report was
-- confirmed correct as shipped):
--
-- 1. Sequence and churn are facts about a member's WHOLE history, not about
--    the branch a report happens to be scoped to. renew_membership takes a
--    branch independent of the member's earlier membership -- a cross-branch
--    renewal is a supported scenario, it is the product's whole premise. The
--    previous version filtered `ranked` by p_branch_ids before computing
--    row_number() and before the churn lookahead, so a member whose first
--    membership was at branch A and whose renewal was at branch B showed up
--    as a NEW member in a report scoped to [B] (seq resets to 1 because A's
--    row was filtered out), and as CHURNED in a report scoped to [A] (the
--    return at B is invisible to `not exists`). Fix: rank and look ahead over
--    every membership the caller's RLS lets them see, unfiltered by branch,
--    and apply p_branch_ids only when deciding which rows this report EMITS.
--    RLS is still doing the tenant-boundary work; this only stops a report
--    filter from also acting as a blindfold on a member's own history.
--
-- 2. cancel_membership sets status = 'cancelled' and cancelled_at = now(),
--    and never touches end_date. The previous version bucketed a cancelled
--    membership by end_date regardless -- a year-long membership cancelled in
--    month two surfaced ten months later, attributed to a month in which
--    nothing happened, or never surfaced if p_to didn't reach that far. Fix:
--    bucket by the date the membership actually ended -- cancelled_at (read
--    through the org's own timezone, the same way revenue_report already
--    reads paid_at) for a cancellation, end_date for a natural lapse.
create or replace function public.membership_movement(
  p_branch_ids uuid[] default null,
  p_from date default null,
  p_to date default null,
  p_group_by text default 'month'
)
returns table (
  period date,
  branch_id uuid,
  branch_name text,
  new_members bigint,
  renewals bigint,
  expiries bigint,
  churned bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ranked as (
    select
      m.id,
      m.member_id,
      m.branch_id,
      m.start_date,
      m.end_date,
      m.status,
      m.org_id,
      -- The date this membership actually ended: the cancellation date (in
      -- the org's own day, not UTC's) when it was cancelled, the planned end
      -- date when it lapsed on its own.
      case
        when m.status = 'cancelled'::public.membership_status
          then (m.cancelled_at at time zone o.timezone)::date
        else m.end_date
      end as ended_on,
      -- Unfiltered by branch on purpose: a member's place in their own
      -- history does not change depending on which branch a report was
      -- asked about.
      row_number() over (partition by m.member_id order by m.start_date, m.created_at) as seq
    from public.memberships m
    join public.orgs o on o.id = m.org_id
  ),
  sold as (
    select
      public.report_period(ranked.start_date, p_group_by) as period,
      ranked.branch_id,
      count(*) filter (where ranked.seq = 1)::bigint as new_members,
      count(*) filter (where ranked.seq > 1)::bigint as renewals,
      0::bigint as expiries,
      0::bigint as churned
    from ranked
    where (p_branch_ids is null or ranked.branch_id = any(p_branch_ids))
      and ranked.start_date >= coalesce(p_from, public.org_today(ranked.org_id) - 365)
      and ranked.start_date <= coalesce(p_to, public.org_today(ranked.org_id))
    group by 1, 2
  ),
  ended as (
    select
      public.report_period(ranked.ended_on, p_group_by) as period,
      ranked.branch_id,
      0::bigint, 0::bigint,
      count(*)::bigint as expiries,
      -- Churn is an expiry (or cancellation) with nothing sold after it: the
      -- member did not come back, at ANY branch. A return at a different
      -- branch is not churn, it is a member who came back somewhere else.
      count(*) filter (
        where not exists (
          select 1 from ranked later
          where later.member_id = ranked.member_id
            and later.start_date > ranked.ended_on
        )
      )::bigint as churned
    from ranked
    where ranked.status in ('expired'::public.membership_status, 'cancelled'::public.membership_status)
      and (p_branch_ids is null or ranked.branch_id = any(p_branch_ids))
      and ranked.ended_on >= coalesce(p_from, public.org_today(ranked.org_id) - 365)
      and ranked.ended_on <= coalesce(p_to, public.org_today(ranked.org_id))
    group by 1, 2
  ),
  combined as (
    select * from sold
    union all
    select * from ended
  )
  select
    combined.period,
    combined.branch_id,
    b.name,
    sum(combined.new_members)::bigint,
    sum(combined.renewals)::bigint,
    sum(combined.expiries)::bigint,
    sum(combined.churned)::bigint
  from combined
  join public.branches b on b.id = combined.branch_id
  group by 1, 2, 3
  order by 1 desc, 3;
$$;

revoke execute on function public.membership_movement(uuid[], date, date, text) from public, anon;
grant execute on function public.membership_movement(uuid[], date, date, text) to authenticated;
