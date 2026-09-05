-- Phase 6 -- Member-scope RLS. Two things happen here, and the first matters
-- more than the second.
--
-- 1. Until now every "staff read X in their org" policy tested only
--    is_org_member(org_id). That was airtight while org_id could only appear in
--    a staff token. Members now carry org_id too, so those policies would have
--    handed a member the whole gym's roster, invoices and attendance. Each one
--    is rewritten to require a staff principal.
-- 2. Members get their own read policies: their own row, and only rows that
--    belong to them.

create or replace function public.jwt_is_staff()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.jwt_staff_role() is not null;
$$;

revoke execute on function public.jwt_is_staff() from public, anon;
grant execute on function public.jwt_is_staff() to authenticated;

-- 1. Staff reads are staff-only.

drop policy if exists "staff read members in their org" on public.members;
create policy "staff read members in their org"
  on public.members for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

drop policy if exists "staff read memberships in their org" on public.memberships;
create policy "staff read memberships in their org"
  on public.memberships for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

drop policy if exists "staff read invoices in their org" on public.invoices;
create policy "staff read invoices in their org"
  on public.invoices for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

drop policy if exists "staff read payments for their branches" on public.payments;
create policy "staff read payments for their branches"
  on public.payments for select to authenticated
  using (
    public.is_org_member(org_id)
    and public.jwt_is_staff()
    and (public.jwt_is_owner() or public.has_branch_access(branch_id))
  );

drop policy if exists "staff read attendance in their org" on public.attendance;
create policy "staff read attendance in their org"
  on public.attendance for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

drop policy if exists "staff read plans in their org" on public.membership_plans;
create policy "staff read plans in their org"
  on public.membership_plans for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

drop policy if exists "staff read colleagues in their org" on public.staff;
create policy "staff read colleagues in their org"
  on public.staff for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

drop policy if exists "staff read branches in their org" on public.branches;
create policy "staff read branches in their org"
  on public.branches for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

drop policy if exists "staff read their own org" on public.orgs;
create policy "staff read their own org"
  on public.orgs for select to authenticated
  using (public.is_org_member(id) and public.jwt_is_staff());

-- 2. Member reads, scoped to the one member the token names.
--
-- Read-only throughout. Nothing a member does writes a row directly: check-in
-- goes through the QR Edge Function, bookings through an RPC. A member with an
-- insert policy on payments would be a hole no amount of UI could close.

create policy "members read their own record"
  on public.members for select to authenticated
  using (public.jwt_is_member() and id = public.jwt_member_id());

create policy "members read their own memberships"
  on public.memberships for select to authenticated
  using (public.jwt_is_member() and member_id = public.jwt_member_id());

create policy "members read their own invoices"
  on public.invoices for select to authenticated
  using (public.jwt_is_member() and member_id = public.jwt_member_id());

create policy "members read their own payments"
  on public.payments for select to authenticated
  using (public.jwt_is_member() and member_id = public.jwt_member_id());

create policy "members read their own attendance"
  on public.attendance for select to authenticated
  using (public.jwt_is_member() and member_id = public.jwt_member_id());

-- Money and dates render from the org's currency and timezone, so the app needs
-- this one row -- and only this one row.
create policy "members read their own org"
  on public.orgs for select to authenticated
  using (public.jwt_is_member() and id = public.jwt_org_id());

-- The home branch, for the address and opening hours on the member's home
-- screen. branch_ids on a member token holds exactly their home branch.
create policy "members read their home branch"
  on public.branches for select to authenticated
  using (
    public.jwt_is_member()
    and public.is_org_member(org_id)
    and id = any (public.jwt_branch_ids())
  );
