-- settle_invoice had no caller that could reach it.
--
-- 20260920120000 extracted the settlement rule and locked the function down
-- the way an internal trigger helper is locked down -- revoked from
-- authenticated -- because its only caller was a SECURITY DEFINER trigger.
-- adjust_membership_discount is a business RPC and therefore SECURITY
-- INVOKER, like every other one here: it leans on RLS instead of stepping
-- around it. So it runs as the signed-in staff member, and the very first
-- thing it does after moving a total is ask the settlement rule what the
-- invoice now is -- and gets "permission denied for function settle_invoice".
--
-- The fix is not a grant on a definer function, which would hand every signed
-- in client a key that bypasses RLS on any invoice id it can guess. It is to
-- make settle_invoice an invoker function and let RLS decide, exactly like the
-- RPC that calls it:
--   * from adjust_membership_discount, the caller is the owner or the branch
--     manager, who already holds the invoice UPDATE policy;
--   * from the sync_invoice_totals trigger, which is SECURITY DEFINER, the
--     effective user is the function's owner, so the member-app and front-desk
--     payment paths keep working regardless of who recorded the payment.
-- And the function itself stays a no-op in the wrong hands: it takes an
-- invoice id, returns void, and writes only what that invoice's own payment
-- rows already say.

create or replace function public.settle_invoice(p_invoice_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  settled bigint;
begin
  if p_invoice_id is null
     or not exists (select 1 from public.invoices where id = p_invoice_id) then
    return;
  end if;

  select coalesce(sum(p.amount_paisa), 0) into settled
  from public.payments p
  where p.invoice_id = p_invoice_id;

  -- The door guard_invoice_money opens for. `set local` dies with the
  -- transaction, so it can never leak into a PostgREST statement.
  perform set_config('app.settle_invoice', 'on', true);

  update public.invoices i
     set paid_paisa = settled,
         status = (case
           when i.status = 'void' then 'void'
           when settled >= i.total_paisa then 'paid'
           when settled <= 0 then 'unpaid'
           else 'partial'
         end)::public.invoice_status
   where i.id = p_invoice_id;

  perform set_config('app.settle_invoice', 'off', true);
end;
$$;

revoke execute on function public.settle_invoice(uuid) from public, anon;
grant execute on function public.settle_invoice(uuid) to authenticated;
