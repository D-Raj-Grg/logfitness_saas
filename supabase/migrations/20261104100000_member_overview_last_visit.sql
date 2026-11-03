-- A member's last visit, on the member overview.
--
-- "Last seen" was worked out in the page from the newest of the 60 attendance
-- rows it loaded, and the members list had nothing at all. Both now read the
-- same column, so the list, the member screen and anything else on
-- member_overview agree on when someone last came.
--
-- Also an index for "check-ins this staff member did", which the staff screen
-- lists. payments already has payments_collector_idx for the other half.

create or replace view public.member_overview
with (security_invoker = true)
as
select
  m.id,
  m.org_id,
  m.home_branch_id,
  b.name as home_branch_name,
  m.member_code,
  m.full_name,
  m.phone,
  m.email,
  m.photo_path,
  m.status,
  m.joined_on,
  m.left_on,
  cur.id as current_membership_id,
  cur.plan_id as current_plan_id,
  cur.plan_name as current_plan_name,
  cur.plan_type as current_plan_type,
  cur.status as membership_status,
  cur.start_date as membership_start_date,
  cur.end_date as membership_end_date,
  cur.sessions_remaining,
  case
    when cur.end_date is null then null::integer
    else cur.end_date - public.org_today(m.org_id)
  end as days_to_expiry,
  coalesce(dues.due_paisa, 0::numeric) as due_paisa,
  dues.oldest_due_on,
  exists (
    select 1 from public.memberships ms where ms.member_id = m.id
  ) as has_membership_history,
  -- Appended, not slotted in beside left_on: `create or replace view` may only
  -- add columns at the end.
  m.archived_at,
  -- Appended again: still add-only. The date of the member's newest check-in,
  -- from the same index the member screen's attendance tab reads
  -- (attendance_member_recent_idx). A subselect in the select list is only
  -- evaluated for rows that survive the sort and limit, so a paged list pays
  -- for the page, not the whole roster.
  (
    select a.attended_on
    from public.attendance a
    where a.member_id = m.id
    order by a.checked_in_at desc
    limit 1
  ) as last_visit_on
from public.members m
join public.branches b on b.id = m.home_branch_id
left join lateral (
  select ms.*
  from public.memberships ms
  where ms.member_id = m.id
    and ms.status = any (
      array['active'::public.membership_status,
            'upcoming'::public.membership_status,
            'frozen'::public.membership_status]
    )
  order by coalesce(ms.end_date, '9999-12-31'::date) desc, ms.start_date desc
  limit 1
) cur on true
left join lateral (
  select sum(i.due_paisa) as due_paisa, min(i.issued_on) as oldest_due_on
  from public.invoices i
  where i.member_id = m.id
    and i.status = any (
      array['unpaid'::public.invoice_status, 'partial'::public.invoice_status]
    )
    and i.due_paisa > 0
) dues on true;

create index if not exists attendance_checked_in_by_idx
  on public.attendance (checked_in_by, attended_on desc)
  where checked_in_by is not null;
