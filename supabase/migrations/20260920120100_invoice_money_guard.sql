-- An invoice is what was billed, and until now anyone at the front desk could
-- rewrite it.
--
-- `memberships` has been append-only at the money columns since it was created
-- and `payments` has no UPDATE policy at all, but `invoices` was left with the
-- "member-facing staff amend invoices" UPDATE policy and nothing behind it:
-- `prepare_invoice_row` only restores invoice_no and org_id. So a front-desk
-- token could send `PATCH /invoices?id=eq...` with total_paisa = 0 and a due
-- of Rs 6,600 would vanish with no payment, no refund and nothing but an
-- audit_log row to show for it. No application code has ever done this -- the
-- one UPDATE in the repo is the settlement trigger -- which is exactly why
-- closing it costs nothing.
--
-- The policy stays: notes on an invoice are worth editing, and the Flutter app
-- may yet want to. The trigger becomes the real boundary, and it is a guard
-- with one door, opened only by a function that sets a transaction-local GUC.
-- PostgREST cannot set a GUC, so the API side is simply shut.

create or replace function public.guard_invoice_money()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Who the invoice belongs to and what it charges. Only
  -- adjust_membership_discount opens this.
  if coalesce(current_setting('app.adjust_invoice_money', true), '') <> 'on'
     and (new.org_id is distinct from old.org_id
          or new.member_id is distinct from old.member_id
          or new.membership_id is distinct from old.membership_id
          or new.invoice_no is distinct from old.invoice_no
          or new.issued_on is distinct from old.issued_on
          or new.subtotal_paisa is distinct from old.subtotal_paisa
          or new.discount_paisa is distinct from old.discount_paisa
          or new.discount_reason is distinct from old.discount_reason
          or new.discount_note is distinct from old.discount_note
          or new.total_paisa is distinct from old.total_paisa) then
    raise exception 'An invoice is what was billed: use adjust_membership_discount to change %', old.invoice_no
      using errcode = 'insufficient_privilege';
  end if;

  -- What has been settled is derived from the payment rows, never typed. A
  -- status written by hand -- 'void' on an unpaid bill, say -- would clear a
  -- due as thoroughly as editing the total.
  if coalesce(current_setting('app.settle_invoice', true), '') <> 'on'
     and (new.paid_paisa is distinct from old.paid_paisa
          or new.status is distinct from old.status) then
    raise exception 'What an invoice has been paid follows its payments: record a payment or a refund on %', old.invoice_no
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_invoice_money() from public, anon, authenticated;

comment on function public.guard_invoice_money() is
  'Freezes the money columns of an invoice against direct UPDATE. Only settle_invoice() and adjust_membership_discount() hold a key.';

-- Named to sort before invoices_prepare_row, so the raw attempt is what the
-- guard sees rather than the value prepare_invoice_row has already restored.
drop trigger if exists invoices_guard_money on public.invoices;
create trigger invoices_guard_money
  before update on public.invoices
  for each row execute function public.guard_invoice_money();
