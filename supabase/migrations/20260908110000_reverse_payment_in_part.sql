-- Part of an entry never arrived. The desk rang up the full price, the member
-- handed over less, and the sale was already on the books before part payment
-- had a place in the form. Taking the whole entry back and re-recording what
-- came in is three rows and two dialogs for one fact, so the reversal now takes
-- an amount.
--
-- p_amount_paisa is the amount NEVER RECEIVED, not the amount kept. Null means
-- the whole entry, which is what every existing caller sends.

create or replace function public.reverse_payment(
  p_payment_id uuid,
  p_reason text,
  p_amount_paisa bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := public.jwt_staff_id();
  original public.payments%rowtype;
  requested bigint;
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

  requested := coalesce(p_amount_paisa, original.amount_paisa);

  if requested <= 0 then
    raise exception 'A reversal must take back more than nothing'
      using errcode = 'check_violation';
  end if;

  if requested > original.amount_paisa then
    raise exception 'The entry was only %, so no more than that can be taken back',
      original.amount_paisa
      using errcode = 'check_violation';
  end if;

  -- Never take back more than the invoice still holds. Without this, a payment
  -- already refunded could be reversed as well and the invoice would owe more
  -- than it was raised for.
  --
  -- The invoice is also what stops a part reversal from being repeated past the
  -- original entry: each one lowers what is held. A payment with no invoice has
  -- no such ledger to check against, so it goes back whole or not at all.
  if original.invoice_id is null then
    if requested <> original.amount_paisa then
      raise exception 'A payment with no invoice can only be reversed in full'
        using errcode = 'check_violation';
    end if;
    settled := original.amount_paisa;
  else
    select coalesce(sum(p.amount_paisa), 0) into settled
    from public.payments p
    where p.invoice_id = original.invoice_id;
  end if;

  if requested > settled then
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
    'reversal', -requested, original.method,
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
    'amount_paisa', -requested,
    'invoice_id', invoice.id,
    'invoice_no', invoice.invoice_no,
    'due_paisa', invoice.due_paisa,
    'status', invoice.status
  );
end;
$$;

-- The two-argument form would otherwise still be resolvable and would shadow
-- the default, leaving a second body to keep in step.
drop function if exists public.reverse_payment(uuid, text);

revoke execute on function public.reverse_payment(uuid, text, bigint) from public, anon;
grant execute on function public.reverse_payment(uuid, text, bigint) to authenticated;
