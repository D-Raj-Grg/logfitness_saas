-- A legacy discounted invoice could not take a payment.
--
-- 20260910130000 added the discount reason with four NOT VALID check
-- constraints, meaning to leave history exactly as it was sold. NOT VALID only
-- skips the back-scan, though: it still binds every row the constraint's table
-- writes from then on, and an UPDATE of an old row is such a write. Recording
-- a payment updates the invoice totals through `sync_invoice_totals`, so every
-- invoice discounted before reasons were captured -- fifteen of them on the
-- first gym -- rejected the payment with
-- "invoices_discount_reason_present", and the desk could not settle a bill it
-- had itself raised.
--
-- The rule was never about the row: it is about the act of discounting. So it
-- moves from a check constraint to a trigger that fires on INSERT and on the
-- UPDATE that actually touches the discount. History keeps its silence and is
-- still payable; nothing new can be discounted without a reason.

alter table public.invoices
  drop constraint if exists invoices_discount_reason_present,
  drop constraint if exists invoices_discount_note_for_other;

alter table public.memberships
  drop constraint if exists memberships_discount_reason_present,
  drop constraint if exists memberships_discount_note_for_other;

-- Shared by both tables: the sale and the paper carry the same two columns and
-- must agree about them.
create or replace function public.guard_discount_reason()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- An update that leaves the discount alone is not a discounting decision.
  -- This is what lets a pre-reason invoice be paid, voided or corrected.
  if tg_op = 'UPDATE'
     and new.discount_paisa is not distinct from old.discount_paisa
     and new.discount_reason is not distinct from old.discount_reason
     and new.discount_note is not distinct from old.discount_note then
    return new;
  end if;

  if (new.discount_paisa = 0) <> (new.discount_reason is null) then
    if new.discount_reason is null then
      raise exception 'A discount needs a reason'
        using errcode = 'check_violation';
    else
      raise exception 'A reason was given for a discount of nothing'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.discount_reason = 'other'::public.discount_reason
     and nullif(btrim(coalesce(new.discount_note, '')), '') is null then
    raise exception 'Say what the other reason was'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_discount_reason() from public, anon, authenticated;

comment on function public.guard_discount_reason() is
  'Every discount written from 20260910 on carries its reason. Rows discounted before that are left alone, and stay payable.';

drop trigger if exists invoices_guard_discount_reason on public.invoices;
create trigger invoices_guard_discount_reason
  before insert or update on public.invoices
  for each row execute function public.guard_discount_reason();

drop trigger if exists memberships_guard_discount_reason on public.memberships;
create trigger memberships_guard_discount_reason
  before insert or update on public.memberships
  for each row execute function public.guard_discount_reason();
