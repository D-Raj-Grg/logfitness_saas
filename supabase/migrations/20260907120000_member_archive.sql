-- Archiving a member: the answer to "delete this record" that does not destroy
-- the cash trail behind it.
--
-- The desk asks for delete when someone was entered twice, or joined, paid
-- nothing, and never came back -- rows that should stop cluttering the list.
-- `left` cannot serve that: it is a fact about a real member who stopped
-- training, and reports count on it. So archiving is its own axis. It hides the
-- member from every default list and search; it changes no membership, no
-- invoice, and no derived status.
--
-- A true delete still exists, still owner-only ("owners delete members" in
-- 20260905120600_member_spine_rls.sql), and still takes the member's payment
-- history with it. The product routes everyone else here.

alter table public.members
  add column archived_at timestamptz,
  add column archived_reason text,
  add column archived_by uuid;

alter table public.members
  add constraint members_archived_by_fkey
    foreign key (archived_by, org_id)
    references public.staff (id, org_id) on delete set null;

-- Every list read filters on it, and almost every row is null, so the index
-- only carries the archived minority.
create index members_archived_idx
  on public.members (org_id, archived_at)
  where archived_at is not null;

-- The view is what the list, the check-in search, and the dashboard tiles read.
-- It carries the column rather than filtering on it: "show me the archived
-- ones" is a real screen, and a view that hid them could not answer it.
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
  m.archived_at
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

-- SECURITY INVOKER like the rest of the spine: the members update policy is the
-- boundary, so whoever may edit a member may archive them, and the audit trigger
-- records who did it with the row's before and after.
create or replace function public.archive_member(
  p_member_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := public.jwt_staff_id();
  member public.members%rowtype;
begin
  if actor is null then
    raise exception 'Only signed-in staff can archive a member'
      using errcode = 'insufficient_privilege';
  end if;

  select * into member from public.members where id = p_member_id;
  if not found then
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;

  if member.archived_at is not null then
    raise exception 'This member is already archived' using errcode = 'check_violation';
  end if;

  update public.members
     set archived_at = now(),
         archived_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         archived_by = actor
   where id = member.id
  returning * into member;

  -- RLS refused the update: this member's home branch is not one the caller
  -- works at. Said plainly, because an empty update reads as success otherwise.
  if not found then
    raise exception 'You can only archive members at your own branch'
      using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'member_id', member.id,
    'archived_at', member.archived_at
  );
end;
$$;

revoke execute on function public.archive_member(uuid, text) from public, anon;
grant execute on function public.archive_member(uuid, text) to authenticated;


create or replace function public.restore_member(p_member_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  member public.members%rowtype;
begin
  update public.members
     set archived_at = null,
         archived_reason = null,
         archived_by = null
   where id = p_member_id
  returning * into member;

  if not found then
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;

  return jsonb_build_object('member_id', member.id, 'status', member.status);
end;
$$;

revoke execute on function public.restore_member(uuid) from public, anon;
grant execute on function public.restore_member(uuid) to authenticated;
