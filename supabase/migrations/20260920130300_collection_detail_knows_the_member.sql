-- The drawer sheet's member list needed a phone number and a balance.
--
-- "Members who paid" answers who the money came from, and the next two
-- questions it provokes are always the same: how do I reach them, and are they
-- square now? Both were a click into the member's page, one member at a time,
-- which is the click this sheet exists to save. A desk chasing the day's
-- shortfalls wants one list, not fourteen tabs.
--
-- member_due_paisa is the member's whole outstanding balance right now, not
-- the remainder of the invoice this payment settled. That is deliberate: a
-- member who cleared one invoice today while another still runs is not square,
-- and the number worth showing beside "paid NPR 2,500" is what is still owed
-- altogether. It is read from member_overview, which is where every other
-- screen gets that figure, so the sheet cannot disagree with the member's own
-- page or with the arrears tab.
--
-- The return type changes, so this is a drop and recreate rather than a
-- replace. Nothing but the collection sheet and its CSV reads the function --
-- it was added earlier today in 20260920130200.

drop function if exists public.daily_collection_detail(date, uuid[]);

create function public.daily_collection_detail(
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
        = coalesce(p_on, public.org_today(p.org_id))
  order by b.name, coalesce(s.full_name, 'Removed staff'), p.method, p.paid_at;
$$;

revoke execute on function public.daily_collection_detail(date, uuid[]) from public, anon;
grant execute on function public.daily_collection_detail(date, uuid[]) to authenticated;

comment on function public.daily_collection_detail(date, uuid[]) is
  'Every payment taken on one day, named, timed and reachable, with what the member still owes. Ordered to match daily_collection so the two can be zipped together.';
