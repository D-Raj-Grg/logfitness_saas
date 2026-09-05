-- member_code, invoice_no and the two business dates are filled by BEFORE
-- triggers, but with no column default the generated TypeScript types insist
-- every caller passes them. Giving them placeholder defaults keeps the runtime
-- behaviour identical -- the trigger overwrites both -- while letting the types
-- say what is actually true: the application does not supply these.

alter table public.members
  alter column member_code set default '',
  alter column joined_on set default (now() at time zone 'Asia/Kathmandu')::date;

alter table public.invoices
  alter column invoice_no set default '',
  alter column issued_on set default (now() at time zone 'Asia/Kathmandu')::date;
