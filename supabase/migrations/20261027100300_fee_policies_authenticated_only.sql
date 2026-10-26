-- The fees policies apply to signed-in users only, like every other table's.
--
-- 20261027100000 created the policies without a TO clause, which means PUBLIC.
-- Every existing policy on membership_plans, memberships, invoices and payments
-- is TO authenticated, so for the anon role no policy applies and a read is
-- quietly empty. Mine did apply to anon, which evaluates jwt_is_staff() -- a
-- function anon cannot execute -- so an anonymous read of fees or
-- membership_fees failed with "permission denied for function jwt_is_staff"
-- instead of returning nothing. No data was ever exposed (the policy denies
-- anon either way); the difference was an error where the rest of the schema
-- gives an empty result.
alter policy "staff read fees in their org" on public.fees to authenticated;
alter policy "owners create fees" on public.fees to authenticated;
alter policy "owners update fees" on public.fees to authenticated;

alter policy "staff read membership fees in their org"
  on public.membership_fees to authenticated;
alter policy "member-facing staff write membership fees with the sale"
  on public.membership_fees to authenticated;
