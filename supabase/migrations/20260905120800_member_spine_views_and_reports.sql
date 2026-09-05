-- Read models for the member spine. All of these are security_invoker, so the
-- caller's RLS policies apply exactly as they do on the base tables.

-- One row per member with the answers the front desk needs before they finish
-- typing: which plan, running until when, and how much is owed.
create view public.member_overview
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
    when cur.end_date is null then null
    else cur.end_date - public.org_today(m.org_id)
  end as days_to_expiry,
  coalesce(dues.due_paisa, 0) as due_paisa,
  dues.oldest_due_on
from public.members m
join public.branches b on b.id = m.home_branch_id
left join lateral (
  select ms.*
  from public.memberships ms
  where ms.member_id = m.id
    and ms.status in ('active', 'upcoming', 'frozen')
  order by coalesce(ms.end_date, date '9999-12-31') desc, ms.start_date desc
  limit 1
) cur on true
left join lateral (
  select
    sum(i.due_paisa) as due_paisa,
    min(i.issued_on) as oldest_due_on
  from public.invoices i
  where i.member_id = m.id
    and i.status in ('unpaid', 'partial')
    and i.due_paisa > 0
) dues on true;

grant select on public.member_overview to authenticated;


-- DAILY COLLECTION -----------------------------------------------------------
-- What each person took, by method, for one day at one branch. This is the sheet
-- the drawer is counted against at close.
create or replace function public.daily_collection(
  p_on date default null,
  p_branch_id uuid default null
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
  where (p_branch_id is null or p.branch_id = p_branch_id)
    -- The business day is the org's day, not UTC's. A 10pm payment in Kathmandu
    -- belongs to that evening's drawer, not to tomorrow's.
    and (p.paid_at at time zone o.timezone)::date
        = coalesce(p_on, public.org_today(p.org_id))
  group by p.branch_id, b.name, p.collected_by, s.full_name, p.method, p.kind
  order by b.name, coalesce(s.full_name, 'Removed staff'), p.method;
$$;

grant execute on function public.daily_collection(date, uuid) to authenticated;


-- ARREARS --------------------------------------------------------------------
-- Who owes what, and for how long. The buckets are the ones a collections call
-- list is worked from.
create or replace function public.arrears_report(p_branch_id uuid default null)
returns table (
  member_id uuid,
  member_code text,
  full_name text,
  phone text,
  home_branch_id uuid,
  home_branch_name text,
  due_paisa bigint,
  oldest_due_on date,
  age_days integer,
  bucket text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    o.id,
    o.member_code,
    o.full_name,
    o.phone,
    o.home_branch_id,
    o.home_branch_name,
    o.due_paisa,
    o.oldest_due_on,
    (public.org_today(o.org_id) - o.oldest_due_on)::integer as age_days,
    case
      when public.org_today(o.org_id) - o.oldest_due_on <= 30 then '0-30'
      when public.org_today(o.org_id) - o.oldest_due_on <= 60 then '31-60'
      when public.org_today(o.org_id) - o.oldest_due_on <= 90 then '61-90'
      else '90+'
    end as bucket
  from public.member_overview o
  where o.due_paisa > 0
    and (p_branch_id is null or o.home_branch_id = p_branch_id)
  order by o.oldest_due_on, o.due_paisa desc;
$$;

grant execute on function public.arrears_report(uuid) to authenticated;


-- NIGHTLY SWEEP SCHEDULE -----------------------------------------------------
-- 20:15 UTC is 02:00 the next day in Kathmandu: after the last branch closes,
-- before the first one opens.
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'sweep-membership-expiry',
  '15 20 * * *',
  $cron$select public.sweep_membership_expiry();$cron$
);
