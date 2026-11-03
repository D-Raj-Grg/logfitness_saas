-- Managers may delete visitor records at branches they work at; owners anywhere.
drop policy "owners delete visitors" on public.visitors;

create policy "owners and managers delete visitors"
  on public.visitors for delete to authenticated
  using (
    public.is_org_member(org_id)
    and (
      public.jwt_is_owner()
      or (
        public.jwt_staff_role() = 'manager'::public.staff_role
        and public.has_branch_access(branch_id)
      )
    )
  );
