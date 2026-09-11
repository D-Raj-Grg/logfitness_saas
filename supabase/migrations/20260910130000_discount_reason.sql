-- Why a discount was given.
--
-- Until now a discount was a bare number. The desk could knock Rs 600 off and
-- nothing recorded whether that was a festival offer, a student rate, or a
-- favour to the owner's cousin -- so it could not be printed for the member,
-- questioned by the owner, or totalled in a report. The gym owner asked for
-- the reason to reach the customer's invoice, which means it has to be
-- captured at the point of sale and stored beside the amount.
--
-- An enum, not free text: the Flutter app needs the same list, the console
-- must not invent a seventh spelling of "dashain", and this is the house
-- pattern for a fixed set. 'other' carries a note so the desk is never
-- blocked by a reason nobody anticipated.
--
-- Both tables get the columns. memberships is the sale; invoices is what
-- prints, and it already mirrors discount_paisa for exactly that reason.

create type public.discount_reason as enum (
  'festival',
  'student',
  'staff_referral',
  'friend_referral',
  'corporate',
  'other'
);

alter table public.memberships
  add column discount_reason public.discount_reason,
  add column discount_note text check (length(discount_note) <= 120);

alter table public.invoices
  add column discount_reason public.discount_reason,
  add column discount_note text check (length(discount_note) <= 120);

comment on column public.invoices.discount_reason is
  'Why the discount was given. Printed on the invoice beside the amount saved.';
comment on column public.invoices.discount_note is
  'Free text, required when discount_reason is ''other'' and meaningless otherwise.';

-- NOT VALID on purpose. Discounted rows already exist -- they were sold before
-- reasons were captured -- and back-filling them with a reason nobody chose
-- would be inventing a financial record. The constraints bind every row
-- written from here on and leave history exactly as it was sold.
alter table public.memberships
  add constraint memberships_discount_reason_present
    check ((discount_paisa = 0) = (discount_reason is null)) not valid,
  add constraint memberships_discount_note_for_other
    check (discount_reason is distinct from 'other'
           or nullif(btrim(discount_note), '') is not null) not valid;

alter table public.invoices
  add constraint invoices_discount_reason_present
    check ((discount_paisa = 0) = (discount_reason is null)) not valid,
  add constraint invoices_discount_note_for_other
    check (discount_reason is distinct from 'other'
           or nullif(btrim(discount_note), '') is not null) not valid;

-- The reason is part of what was bought, so it is as immutable as the amount.
-- Unchanged from 20260907120400 except for the two new columns.
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
     or new.discount_paisa is distinct from old.discount_paisa
     or new.discount_reason is distinct from old.discount_reason
     or new.discount_note is distinct from old.discount_note
     or new.plan_type is distinct from old.plan_type
     or new.sessions_total is distinct from old.sessions_total
     or new.created_at is distinct from old.created_at then
    raise exception 'Membership history is append-only: sell a new membership instead of rewriting %', old.id
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
