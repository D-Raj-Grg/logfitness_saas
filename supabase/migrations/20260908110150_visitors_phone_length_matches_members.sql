-- 30 was arbitrary and one character short of the schema every other phone in
-- the product is validated against (`phoneSchema` in lib/validation/members.ts
-- allows 32), so a long international number would have been refused here and
-- accepted on the member it becomes.
alter table public.visitors drop constraint visitors_phone_check;
alter table public.visitors
  add constraint visitors_phone_check check (length(btrim(phone)) between 1 and 32);
