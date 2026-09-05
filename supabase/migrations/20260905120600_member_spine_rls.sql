-- RLS for the member spine. Same shape as the Phase 0 policies: start from
-- public.is_org_member(), then narrow by role and by branch.

-- Trainers see the floor, not the till. This predicate is the line between the
-- two, and every write policy below starts from it.
create or replace function public.jwt_can_serve_members()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select public.jwt_staff_role() in (
    'owner'::public.staff_role,
    'manager'::public.staff_role,
    'front_desk'::public.staff_role
  );
$$;

-- MEMBERS --------------------------------------------------------------------
-- Read is org-wide on purpose: a member who walks into another branch of the
-- same chain must be found, not re-registered. Writes stay branch-scoped.
create policy "staff read members in their org"
  on public.members for select to authenticated
  using (public.is_org_member(org_id));

create policy "member-facing staff register members"
  on public.members for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and public.has_branch_access(home_branch_id)
  );

create policy "member-facing staff edit members"
  on public.members for update to authenticated
  using (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and public.has_branch_access(home_branch_id)
  )
  with check (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and public.has_branch_access(home_branch_id)
  );

-- Deleting a member destroys their payment history with them. Owners only, and
-- the product routes staff to "mark as left" instead.
create policy "owners delete members"
  on public.members for delete to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_owner());

-- MEMBERSHIP PLANS -----------------------------------------------------------
-- Everyone reads the catalogue: the front desk sells from it. Pricing is set by
-- the owner, or by a manager for the branches they actually run.
create policy "staff read plans in their org"
  on public.membership_plans for select to authenticated
  using (public.is_org_member(org_id));

create policy "owners and managers create plans"
  on public.membership_plans for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and (
      public.jwt_is_owner()
      or (
        public.jwt_staff_role() = 'manager'::public.staff_role
        and coalesce(array_length(branch_ids, 1), 0) > 0
        and branch_ids <@ public.jwt_branch_ids()
      )
    )
  );

create policy "owners and managers update plans"
  on public.membership_plans for update to authenticated
  using (
    public.is_org_member(org_id)
    and (
      public.jwt_is_owner()
      or (
        public.jwt_staff_role() = 'manager'::public.staff_role
        and coalesce(array_length(branch_ids, 1), 0) > 0
        and branch_ids <@ public.jwt_branch_ids()
      )
    )
  )
  with check (
    public.is_org_member(org_id)
    and (
      public.jwt_is_owner()
      or (
        public.jwt_staff_role() = 'manager'::public.staff_role
        and coalesce(array_length(branch_ids, 1), 0) > 0
        and branch_ids <@ public.jwt_branch_ids()
      )
    )
  );

create policy "owners delete plans"
  on public.membership_plans for delete to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_owner());

-- MEMBERSHIPS ----------------------------------------------------------------
-- No delete policy: memberships are history. The guard trigger blocks the
-- superuser path too, so the absence here is belt and braces.
create policy "staff read memberships in their org"
  on public.memberships for select to authenticated
  using (public.is_org_member(org_id));

create policy "member-facing staff sell memberships"
  on public.memberships for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and public.has_branch_access(branch_id)
  );

create policy "member-facing staff move memberships"
  on public.memberships for update to authenticated
  using (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and public.has_branch_access(branch_id)
  )
  with check (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and public.has_branch_access(branch_id)
  );

-- INVOICES -------------------------------------------------------------------
-- Read is org-wide so the check-in screen can state dues wherever the member
-- turns up. Writes follow the branch that raised the invoice.
create policy "staff read invoices in their org"
  on public.invoices for select to authenticated
  using (public.is_org_member(org_id));

create policy "member-facing staff raise invoices"
  on public.invoices for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and public.has_branch_access(branch_id)
  );

create policy "member-facing staff amend invoices"
  on public.invoices for update to authenticated
  using (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and public.has_branch_access(branch_id)
  )
  with check (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and public.has_branch_access(branch_id)
  );

-- PAYMENTS -------------------------------------------------------------------
-- Cash is the sensitive surface. Owners see the whole chain; everyone else sees
-- only the branches they work. No update or delete policy exists at all.
create policy "staff read payments for their branches"
  on public.payments for select to authenticated
  using (
    public.is_org_member(org_id)
    and (public.jwt_is_owner() or public.has_branch_access(branch_id))
  );

create policy "member-facing staff record payments"
  on public.payments for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and public.has_branch_access(branch_id)
    -- Staff record cash under their own name. Posting a payment as a colleague
    -- would defeat the drawer reconciliation the column exists for.
    and (collected_by = public.jwt_staff_id() or public.jwt_is_owner())
  );
