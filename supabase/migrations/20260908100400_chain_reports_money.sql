-- Grouping granularity is a parameter, not three copies of a report.
create or replace function public.report_period(p_on date, p_group_by text)
returns date
language sql
immutable
set search_path = ''
as $$
  select case lower(coalesce(p_group_by, 'day'))
    when 'month' then date_trunc('month', p_on)::date
    when 'week' then date_trunc('week', p_on)::date
    else p_on
  end;
$$;

-- Gross, refunds, reversals and net, by period, branch and method.
--
-- Refunds and reversals are separate columns on purpose. A refund says cash
-- left the drawer; a reversal says a note that was rung up never arrived. Both
-- reduce net, and rolling them together would hide which of the two the branch
-- has a problem with -- the whole reason reverse_payment exists.
create or replace function public.revenue_report(
  p_branch_ids uuid[] default null,
  p_from date default null,
  p_to date default null,
  p_group_by text default 'day'
)
returns table (
  period date,
  branch_id uuid,
  branch_name text,
  method public.payment_method,
  gross_paisa bigint,
  refunds_paisa bigint,
  reversals_paisa bigint,
  net_paisa bigint,
  txn_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with paid as (
    select
      p.branch_id,
      b.name as branch_name,
      p.method,
      p.kind,
      p.amount_paisa,
      (p.paid_at at time zone o.timezone)::date as paid_on,
      p.org_id
    from public.payments p
    join public.branches b on b.id = p.branch_id
    join public.orgs o on o.id = p.org_id
    where (p_branch_ids is null or p.branch_id = any(p_branch_ids))
  )
  select
    public.report_period(paid.paid_on, p_group_by),
    paid.branch_id,
    paid.branch_name,
    paid.method,
    coalesce(sum(paid.amount_paisa) filter (where paid.kind = 'payment'::public.payment_kind), 0)::bigint,
    coalesce(abs(sum(paid.amount_paisa) filter (where paid.kind = 'refund'::public.payment_kind)), 0)::bigint,
    coalesce(abs(sum(paid.amount_paisa) filter (where paid.kind = 'reversal'::public.payment_kind)), 0)::bigint,
    coalesce(sum(paid.amount_paisa), 0)::bigint,
    count(*)::bigint
  from paid
  where paid.paid_on >= coalesce(p_from, public.org_today(paid.org_id) - 30)
    and paid.paid_on <= coalesce(p_to, public.org_today(paid.org_id))
  group by 1, 2, 3, 4
  order by 1 desc, 3, 4;
$$;

-- New, renewed, expired, churned -- per period, per branch.
--
-- "New" is a member's FIRST membership; every later one is a renewal. The
-- append-only rule is what makes that readable: a renewal inserts a row rather
-- than updating one, so the sale is still there to count.
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
      row_number() over (partition by m.member_id order by m.start_date, m.created_at) as seq
    from public.memberships m
    where (p_branch_ids is null or m.branch_id = any(p_branch_ids))
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
    where ranked.start_date >= coalesce(p_from, public.org_today(ranked.org_id) - 365)
      and ranked.start_date <= coalesce(p_to, public.org_today(ranked.org_id))
    group by 1, 2
  ),
  ended as (
    select
      public.report_period(ranked.end_date, p_group_by) as period,
      ranked.branch_id,
      0::bigint, 0::bigint,
      count(*)::bigint as expiries,
      -- Churn is an expiry with nothing sold after it: the member did not come
      -- back. An expiry followed by a renewal is not churn, it is a late payer.
      count(*) filter (
        where not exists (
          select 1 from ranked later
          where later.member_id = ranked.member_id
            and later.start_date > ranked.end_date
        )
      )::bigint as churned
    from ranked
    where ranked.status in ('expired'::public.membership_status, 'cancelled'::public.membership_status)
      and ranked.end_date >= coalesce(p_from, public.org_today(ranked.org_id) - 365)
      and ranked.end_date <= coalesce(p_to, public.org_today(ranked.org_id))
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

revoke execute on function public.report_period(date, text) from public, anon;
revoke execute on function public.revenue_report(uuid[], date, date, text) from public, anon;
revoke execute on function public.membership_movement(uuid[], date, date, text) from public, anon;

grant execute on function public.report_period(date, text) to authenticated;
grant execute on function public.revenue_report(uuid[], date, date, text) to authenticated;
grant execute on function public.membership_movement(uuid[], date, date, text) to authenticated;
