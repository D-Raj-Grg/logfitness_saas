-- The lines behind the drawer sheet.
--
-- The grouped sheet says a collector took NPR 27,000 across twelve FonePay
-- transactions. It cannot answer the only question anyone asks next -- which
-- twelve? -- and it never names a member, so "who paid today" is unanswerable
-- from the one screen that exists to account for today's money. daily_collection
-- is pre-aggregated and carries no payment ids, by design; this returns the
-- rows underneath it.
--
-- The whole day comes back in one query rather than a row at a time. The sheet
-- is a server component: a per-row function would mean a round trip on every
-- click, a route handler, a loading state and a second auth path, to fetch a
-- bounded set that payments_collection_idx already covers. It is also the only
-- shape that lets the printed sheet carry full detail without somebody having
-- clicked every group first.
--
-- The order by matches daily_collection's exactly. The two are zipped together
-- in TypeScript, and a detail line that sorted differently would hang under the
-- wrong group total.

create or replace function public.daily_collection_detail(
  p_on date default null,
  p_branch_ids uuid[] default null
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
  left join public.staff s on s.id = p.collected_by
  left join public.invoices i on i.id = p.invoice_id
  where (p_branch_ids is null or p.branch_id = any(p_branch_ids))
    and (p.paid_at at time zone o.timezone)::date
        = coalesce(p_on, public.org_today(p.org_id))
  order by b.name, coalesce(s.full_name, 'Removed staff'), p.method, p.paid_at;
$$;

revoke execute on function public.daily_collection_detail(date, uuid[]) from public, anon;
grant execute on function public.daily_collection_detail(date, uuid[]) to authenticated;

comment on function public.daily_collection_detail(date, uuid[]) is
  'Every payment taken on one day, named and timed, ordered to match daily_collection so the two can be zipped together.';
