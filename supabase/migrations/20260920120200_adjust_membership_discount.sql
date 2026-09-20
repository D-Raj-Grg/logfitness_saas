-- Lowering a price that has already been billed.
--
-- The desk rings up Gym + Cardio at Rs 6,600, the member comes back the same
-- week and negotiates Rs 6,000, and the owner agrees. Until now there was no
-- way to say so: the discount is set at the point of sale and then frozen
-- along with everything else that describes what was bought, so the only
-- route was to cancel the membership and sell it again -- which burns an
-- invoice number, breaks the renewal chain and tells an auditor a story that
-- did not happen.
--
-- What actually happened is that the same membership was sold at a discount,
-- agreed late. So the discount is what moves. price_paisa and the invoice
-- subtotal stay at 6,600: the plan's price is a fact, and a discount the gym
-- can see is worth more than a quietly smaller number. The member's invoice
-- already prints the discount and its reason, so the corrected bill reads
-- 6,600 less 600.
--
-- Three rules keep this from becoming a way to make dues disappear:
--   * owner or branch manager only, the same gate as adjust_membership_dates;
--   * the discount can only grow -- a price never walks back up, because that
--     would be a new charge and a new charge is a new sale;
--   * never below what has already been collected. Money that came in is
--     refunded, not un-billed.
--
-- Unchanged from 20260910130000 except that the discount trio leaves the
-- blanket block for a door of its own, exactly as start_date did in
-- 20260907120400.
create or replace function public.guard_membership_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.org_id is distinct from old.org_id
     or new.member_id is distinct from old.member_id
     or new.plan_id is distinct from old.plan_id
     or new.branch_id is distinct from old.branch_id
     or new.price_paisa is distinct from old.price_paisa
     or new.plan_type is distinct from old.plan_type
     or new.sessions_total is distinct from old.sessions_total
     or new.created_at is distinct from old.created_at then
    raise exception 'Membership history is append-only: sell a new membership instead of rewriting %', old.id
      using errcode = 'insufficient_privilege';
  end if;

  if (new.discount_paisa is distinct from old.discount_paisa
      or new.discount_reason is distinct from old.discount_reason
      or new.discount_note is distinct from old.discount_note)
     and coalesce(current_setting('app.adjust_membership_discount', true), '') <> 'on' then
    raise exception 'The discount on a membership is agreed when it is sold; use adjust_membership_discount to change it'
      using errcode = 'insufficient_privilege';
  end if;

  if new.start_date is distinct from old.start_date
     and coalesce(current_setting('app.shift_membership_dates', true), '') <> 'on' then
    raise exception 'The start date of a membership is set when it is sold; use adjust_membership_dates to move it'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_membership_immutability() from public, anon, authenticated;


create or replace function public.adjust_membership_discount(
  p_membership_id uuid,
  p_discount_paisa bigint,
  p_discount_reason public.discount_reason,
  p_reason text,
  p_discount_note text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := public.jwt_staff_id();
  membership public.memberships%rowtype;
  invoice public.invoices%rowtype;
  note_clean text := nullif(btrim(coalesce(p_discount_note, '')), '');
  previous_discount bigint;
  new_total bigint;
  today date;
begin
  if actor is null then
    raise exception 'Only signed-in staff can change a price'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A price change must record a reason' using errcode = 'check_violation';
  end if;

  select * into membership from public.memberships where id = p_membership_id;
  if not found then
    raise exception 'Membership not found' using errcode = 'no_data_found';
  end if;

  -- Discounting after the fact is giving money away on a sale already rung up,
  -- so it sits with the people who answer for the branch's takings.
  if not (
    public.jwt_is_owner()
    or (
      public.jwt_staff_role() = 'manager'::public.staff_role
      and public.has_branch_access(membership.branch_id)
    )
  ) then
    raise exception 'Only an owner or the branch manager can change a price'
      using errcode = 'insufficient_privilege';
  end if;

  if membership.status = 'cancelled' then
    raise exception 'This membership is cancelled; sell a new one instead'
      using errcode = 'check_violation';
  end if;

  -- for update: the invoice's paid_paisa is read and then reasoned about, and
  -- a payment landing in between would make the overpayment check a lie.
  select * into invoice
  from public.invoices
  where membership_id = membership.id
  for update;

  if not found then
    raise exception 'This membership has no invoice to adjust' using errcode = 'no_data_found';
  end if;

  if invoice.status = 'void' then
    raise exception 'Invoice % is void' , invoice.invoice_no using errcode = 'check_violation';
  end if;

  if p_discount_paisa is null or p_discount_paisa < 0 then
    raise exception 'Amounts cannot be negative' using errcode = 'check_violation';
  end if;

  if p_discount_paisa > invoice.subtotal_paisa then
    raise exception 'Discount cannot exceed the price' using errcode = 'check_violation';
  end if;

  previous_discount := membership.discount_paisa;

  -- A price that goes back up is a fresh charge on a bill the member has
  -- already been handed. That is a sale, not a correction.
  if p_discount_paisa <= previous_discount then
    raise exception 'A price can only come down; this one is already Rs %',
      trunc((invoice.subtotal_paisa - previous_discount) / 100.0, 2)
      using errcode = 'check_violation';
  end if;

  if p_discount_reason is null then
    raise exception 'Choose a reason for the discount' using errcode = 'check_violation';
  end if;

  if p_discount_reason = 'other' and note_clean is null then
    raise exception 'Describe the discount reason' using errcode = 'check_violation';
  end if;

  if p_discount_reason is distinct from 'other' then
    note_clean := null;
  end if;

  new_total := invoice.subtotal_paisa - p_discount_paisa;

  -- Cash already in the drawer leaves by the refund door, where it is counted.
  if new_total < invoice.paid_paisa then
    raise exception 'Rs % has already been collected on invoice %; refund the difference before lowering the price',
      trunc(invoice.paid_paisa / 100.0, 2), invoice.invoice_no
      using errcode = 'check_violation';
  end if;

  today := public.org_today(membership.org_id);

  -- The one door the immutability trigger opens for, and only for this
  -- statement: `set local` dies with the transaction.
  perform set_config('app.adjust_membership_discount', 'on', true);

  update public.memberships
     set discount_paisa = p_discount_paisa,
         discount_reason = p_discount_reason,
         discount_note = note_clean,
         -- The reason belongs on the row an auditor is looking at, not only in
         -- audit_log. Appended, so earlier adjustments survive.
         notes = btrim(
           coalesce(notes || E'\n', '')
           || to_char(today, 'YYYY-MM-DD') || ': price '
           || trunc((invoice.subtotal_paisa - previous_discount) / 100.0, 2)
           || ' -> ' || trunc(new_total / 100.0, 2)
           || ' (' || btrim(p_reason) || ')'
         )
   where id = membership.id
  returning * into membership;

  if not found then
    raise exception 'You can only change memberships at your own branch'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('app.adjust_membership_discount', 'off', true);

  -- The invoice is the member's copy of the same decision. Its notes are left
  -- alone: the negotiation is the gym's business, not the member's paper.
  perform set_config('app.adjust_invoice_money', 'on', true);

  update public.invoices
     set discount_paisa = p_discount_paisa,
         discount_reason = p_discount_reason,
         discount_note = note_clean,
         total_paisa = new_total
   where id = invoice.id;

  perform set_config('app.adjust_invoice_money', 'off', true);

  -- The total moved under payments that are already in, so what counts as
  -- settled has to be asked again: a part-paid bill can land exactly on paid.
  perform public.settle_invoice(invoice.id);

  select * into invoice from public.invoices where id = invoice.id;

  return jsonb_build_object(
    'membership_id', membership.id,
    'member_id', membership.member_id,
    'invoice_id', invoice.id,
    'invoice_no', invoice.invoice_no,
    'subtotal_paisa', invoice.subtotal_paisa,
    'previous_discount_paisa', previous_discount,
    'discount_paisa', invoice.discount_paisa,
    'discount_reason', invoice.discount_reason,
    'total_paisa', invoice.total_paisa,
    'paid_paisa', invoice.paid_paisa,
    'due_paisa', invoice.due_paisa,
    'status', invoice.status
  );
end;
$$;

revoke execute on function public.adjust_membership_discount(
  uuid, bigint, public.discount_reason, text, text
) from public, anon;

grant execute on function public.adjust_membership_discount(
  uuid, bigint, public.discount_reason, text, text
) to authenticated;
