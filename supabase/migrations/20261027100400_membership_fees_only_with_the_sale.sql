-- membership_fees can only be written as part of the sale itself.
--
-- 20261027100000 let any staff member who may sell insert a membership_fees row
-- for any membership they could reach. The money is unaffected (price_paisa and
-- the invoice subtotal are written by renew_membership alone), but the printed
-- invoice reads these rows, so a direct insert could put a fee line on an
-- invoice that never charged it, or a "fee off" the member never had.
--
-- The fix is to accept a row only for a membership created in the current
-- transaction. now() is the transaction's start time and memberships.created_at
-- defaults to it, so inside renew_membership the two are equal; a later request
-- over the API is a different transaction, and its membership is older. Only
-- the RPC writes the rows, in the same transaction as the sale, which is what
-- the table is for.
--
-- Checked by hand on 2026-10-27 with two requests: a catalogue sale in one, then
-- an insert of a fee line for that membership in the next as the same owner. The
-- insert was refused (42501). supabase/tests/fees.sql pins the policy's text,
-- because a single psql DO block is one transaction and cannot tell the two
-- requests apart.
drop policy "member-facing staff write membership fees with the sale"
  on public.membership_fees;

create policy "member-facing staff write membership fees with the sale"
  on public.membership_fees for insert
  to authenticated
  with check (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and exists (
      select 1
      from public.memberships m
      where m.id = membership_id
        and m.org_id = membership_fees.org_id
        and public.has_branch_access(m.branch_id)
        and m.created_at = now()
    )
  );
