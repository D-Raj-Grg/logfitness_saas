-- Tell a brand-new member apart from a lapsed one.
--
-- members.status is derived, and a member with no membership computes to
-- 'expired' -- which is correct for every report that counts it, and wrong as
-- the first thing the desk reads on a registration they made two minutes ago.
--
-- The fix is presentational, so the status itself does not move: the Active
-- tile still counts people who actually paid, and the Absent 14+ days report
-- still only walks real members. The view just gains the one fact the badge
-- needs to say "New" instead of "Expired": whether this member has ever had a
-- membership at all. `exists` rather than a count -- nobody needs the number,
-- and it lets the planner stop at the first row.

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
  ) as has_membership_history
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
