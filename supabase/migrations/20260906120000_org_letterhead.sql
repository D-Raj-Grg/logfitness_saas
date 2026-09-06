-- Letterhead. Everything a printed invoice or receipt needs above the fold:
-- who the gym is, how to reach them, and what the tax authority calls them.
-- Real columns rather than orgs.settings jsonb, so they land in the generated
-- types and are enforced by CHECK rather than by hope.
--
-- No RLS work: "owners update their own org" is a table policy and already
-- covers every column added here.

alter table public.orgs
  -- A gym trades under a brand and bills under a registered name. Falls back
  -- to orgs.name when null.
  add column legal_name text
    check (legal_name is null or length(btrim(legal_name)) between 1 and 160),

  -- Multi-line; rendered with whitespace-pre-line on the document.
  add column address text
    check (address is null or length(address) <= 500),

  add column phone text
    check (phone is null or length(btrim(phone)) between 3 and 32),

  add column email text
    check (email is null or (position('@' in email) > 1 and length(email) <= 254)),

  -- Nepal PAN / VAT registration number, printed on every document.
  add column pan_no text
    check (pan_no is null or length(btrim(pan_no)) between 1 and 32),

  -- One line under the totals, e.g. 'VAT not applicable'.
  add column tax_note text
    check (tax_note is null or length(tax_note) <= 200),

  -- Free-text terms / footer block.
  add column invoice_terms text
    check (invoice_terms is null or length(invoice_terms) <= 2000),

  -- Storage object key in the org-logos bucket, keyed <org_id>/logo-<epoch>.<ext>.
  -- Not a URL: the bucket is public, so the URL is derived at render time.
  add column logo_path text
    check (logo_path is null or length(logo_path) <= 400);
