-- Logging a visitor happens somewhere; following one up does not.
--
-- The read policy is org-wide on purpose -- someone who enquired at one branch
-- and walks into another must be found, not logged twice. But the update policy
-- was branch-scoped, so the desk that can see an out-of-branch enquiry, take
-- the call and register the member could not then mark the row: convert_visitor
-- matched zero rows and raised. The member existed and the visitor stayed on
-- the callback list.
--
-- So the insert stays branch-scoped (a walk-in happens at a place, and that is
-- what branch_id records) and the follow-up -- status, note, conversion -- is
-- org-wide for staff, which is the same boundary the read already draws.
-- Nothing financial hangs off a visitor; the delete stays owner-only.
drop policy "staff update visitors at their branches" on public.visitors;

create policy "staff follow up visitors in their org"
  on public.visitors for update to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff())
  with check (public.is_org_member(org_id) and public.jwt_is_staff());
