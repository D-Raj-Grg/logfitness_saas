-- The drawer sheet showed one number, and one number cannot be reconciled.
--
-- Closing a shift means answering four separate questions that a single "net
-- collected" figure collapses into one: what came in and what left again; how
-- much of it is physically in the cash box rather than sitting in a wallet or
-- a bank; how many people actually paid; and how much was billed today that
-- has not been collected yet. Those are four different denominators, and the
-- desk was being handed their sum.
--
-- daily_collection is not replaced. Its grain -- branch, collector, method,
-- kind -- is exactly right for the table body, and every fact here is at a
-- different grain: one row per branch, plus a totals row. Widening it would
-- have meant null-padded columns and a discriminator, and would have broken
-- three test files and the CSV route for nothing.
--
-- The refund and reversal columns deliberately reuse revenue_report's filter
-- expressions word for word (20260908100400). The drawer sheet and the revenue
-- report answer the same question over different windows, and the day they
-- disagree is the day nobody trusts either.

create or replace function public.daily_collection_summary(
  p_on date default null,
  p_branch_ids uuid[] default null
)
returns table (
  branch_id uuid,
  branch_name text,
  on_date date,
  gross_paisa bigint,
  refunds_paisa bigint,
  reversals_paisa bigint,
  net_paisa bigint,
  cash_paisa bigint,
  digital_paisa bigint,
  payment_count bigint,
  refund_count bigint,
  reversal_count bigint,
  txn_count bigint,
  distinct_payers bigint,
  billed_paisa bigint,
  billed_discount_paisa bigint,
  billed_due_paisa bigint,
  invoice_count bigint
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
  -- The business day is the org's day, not UTC's. Same expression
  -- daily_collection uses, so the two cannot disagree about which evening a
  -- 10pm payment belongs to.
  money as (
    select
      p.branch_id as branch_id,
      p.kind as kind,
      p.method as method,
      p.member_id as member_id,
      p.amount_paisa as amount_paisa
    from public.payments p
    join public.orgs o on o.id = p.org_id
    join scoped_branches sb on sb.id = p.branch_id
    where (p.paid_at at time zone o.timezone)::date
        = coalesce(p_on, public.org_today(p.org_id))
  ),
  money_by_branch as (
    select
      money.branch_id as branch_id,
      coalesce(sum(money.amount_paisa) filter (where money.kind = 'payment'::public.payment_kind), 0)::bigint as gross_paisa,
      coalesce(abs(sum(money.amount_paisa) filter (where money.kind = 'refund'::public.payment_kind)), 0)::bigint as refunds_paisa,
      coalesce(abs(sum(money.amount_paisa) filter (where money.kind = 'reversal'::public.payment_kind)), 0)::bigint as reversals_paisa,
      coalesce(sum(money.amount_paisa), 0)::bigint as net_paisa,
      -- Net, not gross: a cash refund leaves the drawer, so this is what should
      -- physically be counted at close. cash + digital = net, and the screen
      -- shows both so that is checkable by eye.
      coalesce(sum(money.amount_paisa) filter (where money.method = 'cash'::public.payment_method), 0)::bigint as cash_paisa,
      coalesce(sum(money.amount_paisa) filter (where money.method <> 'cash'::public.payment_method), 0)::bigint as digital_paisa,
      count(*) filter (where money.kind = 'payment'::public.payment_kind)::bigint as payment_count,
      count(*) filter (where money.kind = 'refund'::public.payment_kind)::bigint as refund_count,
      count(*) filter (where money.kind = 'reversal'::public.payment_kind)::bigint as reversal_count,
      count(*)::bigint as txn_count,
      -- People, not rows. A member who pays twice is one member who paid, and
      -- a member whose only row today is a refund did not pay today.
      count(distinct money.member_id) filter (where money.kind = 'payment'::public.payment_kind)::bigint as distinct_payers
    from money
    group by money.branch_id
  ),
  -- Billed today is a different question from collected today: an invoice
  -- raised this morning and settled next week is money the branch is owed now,
  -- and the gap between these two is today's new chasing.
  billed as (
    select
      i.branch_id as branch_id,
      coalesce(sum(i.total_paisa), 0)::bigint as billed_paisa,
      coalesce(sum(i.discount_paisa), 0)::bigint as billed_discount_paisa,
      coalesce(sum(i.due_paisa), 0)::bigint as billed_due_paisa,
      count(*)::bigint as invoice_count
    from public.invoices i
    join scoped_branches sb on sb.id = i.branch_id
    where i.issued_on = coalesce(p_on, public.org_today(i.org_id))
    group by i.branch_id
  ),
  per_branch as (
    select
      sb.id as branch_id,
      sb.name as branch_name,
      coalesce(p_on, public.org_today(sb.org_id)) as on_date,
      coalesce(m.gross_paisa, 0)::bigint as gross_paisa,
      coalesce(m.refunds_paisa, 0)::bigint as refunds_paisa,
      coalesce(m.reversals_paisa, 0)::bigint as reversals_paisa,
      coalesce(m.net_paisa, 0)::bigint as net_paisa,
      coalesce(m.cash_paisa, 0)::bigint as cash_paisa,
      coalesce(m.digital_paisa, 0)::bigint as digital_paisa,
      coalesce(m.payment_count, 0)::bigint as payment_count,
      coalesce(m.refund_count, 0)::bigint as refund_count,
      coalesce(m.reversal_count, 0)::bigint as reversal_count,
      coalesce(m.txn_count, 0)::bigint as txn_count,
      coalesce(m.distinct_payers, 0)::bigint as distinct_payers,
      coalesce(bi.billed_paisa, 0)::bigint as billed_paisa,
      coalesce(bi.billed_discount_paisa, 0)::bigint as billed_discount_paisa,
      coalesce(bi.billed_due_paisa, 0)::bigint as billed_due_paisa,
      coalesce(bi.invoice_count, 0)::bigint as invoice_count
    from scoped_branches sb
    left join money_by_branch m on m.branch_id = sb.id
    left join billed bi on bi.branch_id = sb.id
  )
  select
    per_branch.branch_id,
    per_branch.branch_name,
    per_branch.on_date,
    per_branch.gross_paisa,
    per_branch.refunds_paisa,
    per_branch.reversals_paisa,
    per_branch.net_paisa,
    per_branch.cash_paisa,
    per_branch.digital_paisa,
    per_branch.payment_count,
    per_branch.refund_count,
    per_branch.reversal_count,
    per_branch.txn_count,
    per_branch.distinct_payers,
    per_branch.billed_paisa,
    per_branch.billed_discount_paisa,
    per_branch.billed_due_paisa,
    per_branch.invoice_count
  from per_branch

  union all

  -- The totals row, branch_id null, exactly as org_snapshot does it.
  select
    null::uuid,
    null::text,
    min(per_branch.on_date),
    coalesce(sum(per_branch.gross_paisa), 0)::bigint,
    coalesce(sum(per_branch.refunds_paisa), 0)::bigint,
    coalesce(sum(per_branch.reversals_paisa), 0)::bigint,
    coalesce(sum(per_branch.net_paisa), 0)::bigint,
    coalesce(sum(per_branch.cash_paisa), 0)::bigint,
    coalesce(sum(per_branch.digital_paisa), 0)::bigint,
    coalesce(sum(per_branch.payment_count), 0)::bigint,
    coalesce(sum(per_branch.refund_count), 0)::bigint,
    coalesce(sum(per_branch.reversal_count), 0)::bigint,
    coalesce(sum(per_branch.txn_count), 0)::bigint,
    -- NOT a sum, and this is the one column where the "totals row = the sum of
    -- the branch rows" rule deliberately does not hold: a member who paid at
    -- two branches today is one member who paid, not two. Re-counted across
    -- the whole scope. Do not "fix" this into sum().
    (select count(distinct money.member_id)
       from money
      where money.kind = 'payment'::public.payment_kind)::bigint,
    coalesce(sum(per_branch.billed_paisa), 0)::bigint,
    coalesce(sum(per_branch.billed_discount_paisa), 0)::bigint,
    coalesce(sum(per_branch.billed_due_paisa), 0)::bigint,
    coalesce(sum(per_branch.invoice_count), 0)::bigint
  from per_branch

  order by branch_name nulls first;
$$;

revoke execute on function public.daily_collection_summary(date, uuid[]) from public, anon;
grant execute on function public.daily_collection_summary(date, uuid[]) to authenticated;

comment on function public.daily_collection_summary(date, uuid[]) is
  'One day of takings per branch plus a totals row: gross, refunds, reversals, net, cash vs digital, who paid, and what was billed. distinct_payers on the totals row is re-counted, not summed.';
