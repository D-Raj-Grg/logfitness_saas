-- Daily collection takes a date range.
--
-- The three collection functions answered one day only, so a manager who
-- wanted "this week's takings" had to open seven sheets and add them up. Each
-- now takes an optional p_to: the window is p_on .. coalesce(p_to, p_on), both
-- ends inclusive, and omitting p_to is exactly the old single-day behaviour.
-- Existing callers (named arguments) are unchanged.
--
-- Day boundaries are still the org's own day (paid_at at time zone
-- orgs.timezone), the same expression in all three, so the sheet, its summary
-- and its detail cannot disagree about which evening a 10pm payment is in.
-- distinct_payers on the summary totals row stays a re-count across the whole
-- window, not a sum: someone who paid on Monday and Friday paid once.
--
-- Signature changes, so drop and recreate.

drop function if exists public.daily_collection(date, uuid[]);
drop function if exists public.daily_collection_summary(date, uuid[]);
drop function if exists public.daily_collection_detail(date, uuid[]);

create function public.daily_collection(
  p_on date default null,
  p_branch_ids uuid[] default null,
  p_to date default null
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
        between coalesce(p_on, public.org_today(p.org_id))
        and coalesce(p_to, p_on, public.org_today(p.org_id))
  group by p.branch_id, b.name, p.collected_by, s.full_name, p.method, p.kind
  order by b.name, coalesce(s.full_name, 'Removed staff'), p.method;
$$;

create function public.daily_collection_summary(
  p_on date default null,
  p_branch_ids uuid[] default null,
  p_to date default null
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
        between coalesce(p_on, public.org_today(p.org_id))
        and coalesce(p_to, p_on, public.org_today(p.org_id))
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
    where i.issued_on between coalesce(p_on, public.org_today(i.org_id))
        and coalesce(p_to, p_on, public.org_today(i.org_id))
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

create function public.daily_collection_detail(
  p_on date default null,
  p_branch_ids uuid[] default null,
  p_to date default null
)
returns table (
  payment_id uuid,
  branch_id uuid,
  branch_name text,
  staff_id uuid,
  staff_name text,
  member_id uuid,
  member_code text,
  member_name text,
  member_phone text,
  member_due_paisa bigint,
  method public.payment_method,
  kind public.payment_kind,
  amount_paisa bigint,
  reference_no text,
  reason text,
  paid_at timestamptz,
  invoice_id uuid,
  invoice_no text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    p.branch_id,
    b.name,
    p.collected_by,
    -- collected_by is nullable so removing a staff row never deletes the record
    -- of cash they took. Same coalesce daily_collection uses, so both group the
    -- orphaned rows under one heading rather than two.
    coalesce(s.full_name, 'Removed staff'),
    p.member_id,
    m.member_code,
    m.full_name,
    m.phone,
    -- Everything this member still owes, across every open invoice. Zero when
    -- they are square; member_overview only carries a row per member, so the
    -- left join is belt and braces rather than a real absence.
    coalesce(mo.due_paisa, 0)::bigint,
    p.method,
    p.kind,
    p.amount_paisa,
    p.reference_no,
    p.reason,
    p.paid_at,
    p.invoice_id,
    i.invoice_no
  from public.payments p
  join public.branches b on b.id = p.branch_id
  join public.orgs o on o.id = p.org_id
  -- payments.member_id is not null, and members are org-scoped rather than
  -- branch-scoped in RLS, so this join never silently drops a payment taken
  -- from a member whose home branch is elsewhere.
  join public.members m on m.id = p.member_id
  left join public.member_overview mo on mo.id = p.member_id
  left join public.staff s on s.id = p.collected_by
  left join public.invoices i on i.id = p.invoice_id
  where (p_branch_ids is null or p.branch_id = any(p_branch_ids))
    and (p.paid_at at time zone o.timezone)::date
        between coalesce(p_on, public.org_today(p.org_id))
        and coalesce(p_to, p_on, public.org_today(p.org_id))
  order by b.name, coalesce(s.full_name, 'Removed staff'), p.method, p.paid_at;
$$;

revoke execute on function public.daily_collection(date, uuid[], date) from public, anon;
grant execute on function public.daily_collection(date, uuid[], date) to authenticated;

revoke execute on function public.daily_collection_summary(date, uuid[], date) from public, anon;
grant execute on function public.daily_collection_summary(date, uuid[], date) to authenticated;

revoke execute on function public.daily_collection_detail(date, uuid[], date) from public, anon;
grant execute on function public.daily_collection_detail(date, uuid[], date) to authenticated;

comment on function public.daily_collection(date, uuid[], date) is
  'Takings grouped by branch, collector, method and kind over p_on..p_to (inclusive, org-local days). p_to omitted = the single day p_on; both omitted = org today.';
comment on function public.daily_collection_summary(date, uuid[], date) is
  'Takings over p_on..p_to per branch plus a totals row: gross, refunds, reversals, net, cash vs digital, who paid, and what was billed. distinct_payers on the totals row is re-counted, not summed.';
comment on function public.daily_collection_detail(date, uuid[], date) is
  'Every payment over p_on..p_to, named, timed and reachable, with what the member still owes. Ordered to match daily_collection so the two can be zipped together.';
