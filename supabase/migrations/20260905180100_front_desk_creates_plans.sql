-- Let the front desk add a plan to the catalogue, scoped to its own branches.
--
-- Scope decision, 2026-09-05. Pricing was an owner/manager job, but the desk is
-- who registers members, and a plan that does not exist yet is discovered at the
-- counter with the member standing there. Making them fetch a manager to add a
-- plan is the paper register all over again.
--
-- The guard rail is that a front desk may only create a plan sold at branches it
-- actually works: branch_ids must be non-empty and a subset of its own. It can
-- add a plan for its gym; it cannot price the whole chain. That is exactly the
-- rule managers already live under, so this widens who it applies to rather than
-- inventing a second policy shape.
--
-- Owners keep unrestricted scoping, including an empty branch_ids that means
-- "sold everywhere". Deleting a plan stays owner-only.
--
-- Members cannot reach either policy: jwt_staff_role() is null for a member
-- token and jwt_is_owner() is false, so the Phase 6 principal split still holds.

drop policy if exists "owners and managers create plans" on public.membership_plans;
drop policy if exists "owners and managers update plans" on public.membership_plans;

create policy "staff create plans for branches they work"
  on public.membership_plans for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and (
      public.jwt_is_owner()
      or (
        public.jwt_staff_role() in (
          'manager'::public.staff_role,
          'front_desk'::public.staff_role
        )
        and coalesce(array_length(branch_ids, 1), 0) > 0
        and branch_ids <@ public.jwt_branch_ids()
      )
    )
  );

create policy "staff update plans for branches they work"
  on public.membership_plans for update to authenticated
  using (
    public.is_org_member(org_id)
    and (
      public.jwt_is_owner()
      or (
        public.jwt_staff_role() in (
          'manager'::public.staff_role,
          'front_desk'::public.staff_role
        )
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
        public.jwt_staff_role() in (
          'manager'::public.staff_role,
          'front_desk'::public.staff_role
        )
        and coalesce(array_length(branch_ids, 1), 0) > 0
        and branch_ids <@ public.jwt_branch_ids()
      )
    )
  );
