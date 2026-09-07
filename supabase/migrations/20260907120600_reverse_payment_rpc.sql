-- The reversal itself. Split from the ALTER TYPE that added the enum value
-- because Postgres refuses to use a new enum label in the transaction that
-- created it.
--
-- A reversal is a negative row, like a refund, and must say why. The shape
-- check is widened rather than rewritten so 'payment' and 'refund' keep exactly
-- the rules they had.
alter table public.payments
  drop constraint payments_kind_shape;

alter table public.payments
  add constraint payments_kind_shape check (
    (kind = 'payment' and amount_paisa > 0)
    or (kind in ('refund', 'reversal')
        and amount_paisa < 0
        and length(btrim(coalesce(reason, ''))) > 0)
  );

-- Owner and manager only. The person who recorded the money is not the person
-- who gets to say it never arrived -- that is the whole control this represents
-- in a cash business. The RPC checks the role itself: the payments insert
-- policy exists for the desk to take money, which it must keep doing.
create or replace function public.reverse_payment(
  p_payment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := public.jwt_staff_id();
  original public.payments%rowtype;
  settled bigint;
  reversal_id uuid;
  invoice public.invoices%rowtype;
begin
  if actor is null then
    raise exception 'Only signed-in staff can reverse a payment'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reversal must record a reason' using errcode = 'check_violation';
  end if;

  select * into original from public.payments where id = p_payment_id;
  if not found then
    raise exception 'Payment not found' using errcode = 'no_data_found';
  end if;

  if not (
    public.jwt_is_owner()
    or (
      public.jwt_staff_role() = 'manager'::public.staff_role
      and public.has_branch_access(original.branch_id)
    )
  ) then
    raise exception 'Only an owner or the branch manager can reverse a payment'
      using errcode = 'insufficient_privilege';
  end if;

  if original.kind <> 'payment' then
    raise exception 'Only a payment can be reversed' using errcode = 'check_violation';
  end if;

  -- Never take back more than the invoice still holds. Without this, a payment
  -- already refunded could be reversed as well and the invoice would owe more
  -- than it was raised for.
  if original.invoice_id is null then
    settled := original.amount_paisa;
  else
    select coalesce(sum(p.amount_paisa), 0) into settled
    from public.payments p
    where p.invoice_id = original.invoice_id;
  end if;

  if original.amount_paisa > settled then
    raise exception 'Only % is still held against this invoice', settled
      using errcode = 'check_violation';
  end if;

  -- The method is carried over so the drawer line lands where the money was
  -- said to have arrived: a cash entry that never happened has to come off the
  -- cash column, not some other one.
  insert into public.payments (
    org_id, branch_id, member_id, membership_id, invoice_id,
    kind, amount_paisa, method, reference_no, reason, collected_by
  )
  values (
    original.org_id, original.branch_id, original.member_id,
    original.membership_id, original.invoice_id,
    'reversal', -original.amount_paisa, original.method,
    original.reference_no, btrim(p_reason), actor
  )
  returning id into reversal_id;

  -- sync_invoice_totals has already put the money back on the invoice; this is
  -- read after the fact so the caller can say what is owed now.
  if original.invoice_id is not null then
    select * into invoice from public.invoices where id = original.invoice_id;
  end if;

  return jsonb_build_object(
    'reversal_id', reversal_id,
    'payment_id', original.id,
    'amount_paisa', -original.amount_paisa,
    'invoice_id', invoice.id,
    'invoice_no', invoice.invoice_no,
    'due_paisa', invoice.due_paisa,
    'status', invoice.status
  );
end;
$$;

revoke execute on function public.reverse_payment(uuid, text) from public, anon;
grant execute on function public.reverse_payment(uuid, text) to authenticated;
