-- What the gym gave away, and why.
--
-- Discounts have been recordable since 20260910130000 and givable from two
-- places since 20260920120200 -- at the point of sale, and afterwards when a
-- price is renegotiated. Nothing has ever totalled them. plan_mix sums
-- memberships.price_paisa and ignores discount_paisa entirely, so an owner can
-- see what was listed and never what was actually charged. A discount nobody
-- adds up is a discount nobody questions.
--
-- This reads invoices rather than memberships on purpose. The invoice is the
-- document the member was handed, and invoices.discount_paisa is the column
-- adjust_membership_discount moves when a sale is re-priced after the fact --
-- memberships carries the same number but is not what the gym billed. It also
-- keeps this at the same grain as daily_collection_summary.billed_discount_paisa,
-- which is what lets the two be asserted equal.
--
-- guard_discount_reason (20260920110000) guarantees a reason wherever
-- discount_paisa > 0 for anything written since reasons existed, so the reason
-- column needs no coalesce fudge. Rows discounted before that are left with a
-- null reason, exactly as they were sold.
--
-- The p_from/p_to defaults copy revenue_report verbatim, so the /reports
-- screen this will grow into behaves like its neighbours from day one.

create or replace function public.discount_report(
  p_branch_ids uuid[] default null,
  p_from date default null,
  p_to date default null
)
returns table (
  branch_id uuid,
  branch_name text,
  reason public.discount_reason,
  invoice_count bigint,
  subtotal_paisa bigint,
  discount_paisa bigint,
  net_billed_paisa bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    i.branch_id,
    b.name,
    i.discount_reason,
    count(*)::bigint,
    coalesce(sum(i.subtotal_paisa), 0)::bigint,
    coalesce(sum(i.discount_paisa), 0)::bigint,
    coalesce(sum(i.total_paisa), 0)::bigint
  from public.invoices i
  join public.branches b on b.id = i.branch_id
  where (p_branch_ids is null or i.branch_id = any(p_branch_ids))
    and i.discount_paisa > 0
    and i.issued_on >= coalesce(p_from, public.org_today(i.org_id) - 30)
    and i.issued_on <= coalesce(p_to, public.org_today(i.org_id))
  group by i.branch_id, b.name, i.discount_reason
  order by b.name, coalesce(sum(i.discount_paisa), 0) desc;
$$;

revoke execute on function public.discount_report(uuid[], date, date) from public, anon;
grant execute on function public.discount_report(uuid[], date, date) to authenticated;

comment on function public.discount_report(uuid[], date, date) is
  'Money given away over a date range, by branch and discount reason. Reads invoices, so a price renegotiated after the sale is counted as it was finally billed.';
