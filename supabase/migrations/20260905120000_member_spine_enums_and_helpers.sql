-- Phase 1 -- Member spine. Enums shared by members, plans, memberships,
-- invoices, and payments, plus the per-org helpers those tables lean on.

create type public.member_status as enum ('active', 'expired', 'frozen', 'left');
create type public.member_gender as enum ('male', 'female', 'other');
create type public.plan_type as enum ('time', 'session_pack');
create type public.membership_status as enum ('upcoming', 'active', 'frozen', 'expired', 'cancelled');
create type public.payment_method as enum ('cash', 'esewa', 'khalti', 'fonepay', 'bank', 'card');
create type public.payment_kind as enum ('payment', 'refund');
create type public.invoice_status as enum ('unpaid', 'partial', 'paid', 'void');

-- Every date in this product is a business date in the org's timezone, not the
-- server's. Expiry on the 30th means the 30th in Kathmandu.
create or replace function public.org_today(p_org_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (
    now() at time zone coalesce(
      (select o.timezone from public.orgs o where o.id = p_org_id),
      'Asia/Kathmandu'
    )
  )::date;
$$;

revoke execute on function public.org_today(uuid) from public, anon;

-- Human-facing counters. Members get M00001, invoices INV000001; both must be
-- unique per org, so they come from a row-locked counter rather than a global
-- sequence. Kept off public.orgs deliberately: orgs is audited, and bumping a
-- counter on every registration would bury the org's real edits in noise.
create table public.org_counters (
  org_id uuid primary key references public.orgs (id) on delete cascade,
  member_seq bigint not null default 0,
  invoice_seq bigint not null default 0
);

alter table public.org_counters enable row level security;

-- No policies: the counters are read and written only by security-definer
-- functions. Nothing in the application touches this table directly.

-- Bumps one counter and hands back the new value. The update takes a row lock,
-- so concurrent registrations at two branches cannot mint the same code.
create or replace function public.next_org_counter(p_org_id uuid, p_counter text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_value bigint;
begin
  insert into public.org_counters (org_id)
  values (p_org_id)
  on conflict (org_id) do nothing;

  if p_counter = 'member' then
    update public.org_counters
       set member_seq = member_seq + 1
     where org_id = p_org_id
    returning member_seq into next_value;
  elsif p_counter = 'invoice' then
    update public.org_counters
       set invoice_seq = invoice_seq + 1
     where org_id = p_org_id
    returning invoice_seq into next_value;
  else
    raise exception 'Unknown counter %', p_counter using errcode = 'check_violation';
  end if;

  return next_value;
end;
$$;

revoke execute on function public.next_org_counter(uuid, text) from public, anon, authenticated;

-- Composite target so child tables can carry a foreign key that pins the branch
-- to the same org as the row referencing it. Cheaper and harder to bypass than
-- a trigger doing the same check.
alter table public.branches
  add constraint branches_id_org_id_key unique (id, org_id);

alter table public.staff
  add constraint staff_id_org_id_key unique (id, org_id);
