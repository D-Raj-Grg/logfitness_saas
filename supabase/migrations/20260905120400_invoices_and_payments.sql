-- Invoices carry what a membership costs; payments carry what was actually
-- handed over. Partial payment is the normal case in this market, so the two
-- are separate tables and the difference is the member's dues.

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  branch_id uuid not null,
  member_id uuid not null,
  membership_id uuid,

  invoice_no text not null,
  subtotal_paisa bigint not null check (subtotal_paisa >= 0),
  discount_paisa bigint not null default 0 check (discount_paisa >= 0),
  total_paisa bigint not null check (total_paisa >= 0),

  -- Maintained by trigger from the payment rows. Refunds are negative payments,
  -- so a refunded invoice walks back down to a due balance on its own.
  paid_paisa bigint not null default 0,
  due_paisa bigint generated always as (total_paisa - paid_paisa) stored,

  status public.invoice_status not null default 'unpaid',
  issued_on date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, invoice_no),
  unique (id, org_id),
  unique (membership_id),

  constraint invoices_branch_fkey
    foreign key (branch_id, org_id)
    references public.branches (id, org_id) on delete restrict,

  constraint invoices_member_fkey
    foreign key (member_id, org_id)
    references public.members (id, org_id) on delete cascade,

  constraint invoices_membership_fkey
    foreign key (membership_id, org_id)
    references public.memberships (id, org_id) on delete cascade,

  constraint invoices_total_is_net
    check (total_paisa = subtotal_paisa - discount_paisa),

  constraint invoices_discount_within_subtotal
    check (discount_paisa <= subtotal_paisa)
);

create index invoices_org_idx on public.invoices (org_id);
create index invoices_member_idx on public.invoices (member_id, issued_on desc);
create index invoices_branch_issued_idx on public.invoices (org_id, branch_id, issued_on desc);
create index invoices_outstanding_idx
  on public.invoices (org_id, issued_on)
  where status in ('unpaid', 'partial');

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

create or replace function public.prepare_invoice_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.issued_on is null then
      new.issued_on := public.org_today(new.org_id);
    end if;

    if new.invoice_no is null or btrim(new.invoice_no) = '' then
      new.invoice_no := 'INV' || lpad(
        public.next_org_counter(new.org_id, 'invoice')::text, 6, '0'
      );
    end if;
  else
    new.invoice_no := old.invoice_no;
    new.org_id := old.org_id;
  end if;

  return new;
end;
$$;

revoke execute on function public.prepare_invoice_row() from public, anon, authenticated;

create trigger invoices_prepare_row
  before insert or update on public.invoices
  for each row execute function public.prepare_invoice_row();

create trigger invoices_guard_delete
  before delete on public.invoices
  for each row execute function public.guard_financial_delete();

create trigger invoices_audit
  after insert or update or delete on public.invoices
  for each row execute function public.audit_row();

alter table public.invoices enable row level security;


-- PAYMENTS -------------------------------------------------------------------
-- Immutable once written. A mistake is corrected by a refund row, never by an
-- edit; that is what makes the drawer reconcilable.

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  branch_id uuid not null,
  member_id uuid not null,
  membership_id uuid,
  invoice_id uuid,

  kind public.payment_kind not null default 'payment',

  -- Negative for refunds. Signed so that summing the column gives net cash.
  amount_paisa bigint not null check (amount_paisa <> 0),
  method public.payment_method not null,
  reference_no text,
  reason text,

  -- Nullable only so that deleting a staff row (or a whole org) does not have
  -- to delete the cash record with it. Required on insert by the trigger below.
  collected_by uuid,
  paid_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),

  unique (id, org_id),

  constraint payments_branch_fkey
    foreign key (branch_id, org_id)
    references public.branches (id, org_id) on delete restrict,

  constraint payments_member_fkey
    foreign key (member_id, org_id)
    references public.members (id, org_id) on delete cascade,

  constraint payments_membership_fkey
    foreign key (membership_id, org_id)
    references public.memberships (id, org_id) on delete set null,

  constraint payments_invoice_fkey
    foreign key (invoice_id, org_id)
    references public.invoices (id, org_id) on delete set null,

  constraint payments_collected_by_fkey
    foreign key (collected_by, org_id)
    references public.staff (id, org_id) on delete set null,

  -- A refund is a negative row that must say why. A payment is positive.
  constraint payments_kind_shape check (
    (kind = 'payment' and amount_paisa > 0)
    or (kind = 'refund' and amount_paisa < 0 and length(btrim(coalesce(reason, ''))) > 0)
  ),

  -- Digital rails are push payments confirmed after the fact; without the
  -- reference number the row cannot be reconciled against the gateway.
  constraint payments_digital_needs_reference check (
    method = 'cash'
    or length(btrim(coalesce(reference_no, ''))) > 0
  )
);

create index payments_org_idx on public.payments (org_id);
create index payments_member_idx on public.payments (member_id, paid_at desc);
create index payments_invoice_idx on public.payments (invoice_id);
create index payments_collection_idx
  on public.payments (org_id, branch_id, paid_at desc);
create index payments_collector_idx
  on public.payments (org_id, collected_by, paid_at desc);

-- Every payment names the person who took the money. That is the whole point of
-- the table in a cash business, so it is enforced rather than left to callers.
create or replace function public.require_payment_collector()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.collected_by is null then
    raise exception 'A payment must record who collected it'
      using errcode = 'not_null_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.require_payment_collector() from public, anon, authenticated;

create trigger payments_require_collector
  before insert on public.payments
  for each row execute function public.require_payment_collector();

-- Payments never change and never disappear.
create or replace function public.reject_payment_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Payments are immutable: record a refund row instead of editing %', old.id
    using errcode = 'insufficient_privilege';
end;
$$;

revoke execute on function public.reject_payment_mutation() from public, anon, authenticated;

create trigger payments_immutable
  before update on public.payments
  for each row execute function public.reject_payment_mutation();

create trigger payments_guard_delete
  before delete on public.payments
  for each row execute function public.guard_financial_delete();

create trigger payments_audit
  after insert or update or delete on public.payments
  for each row execute function public.audit_row();

alter table public.payments enable row level security;


-- Invoice totals follow the payment rows, so the two can never drift.
create or replace function public.sync_invoice_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_invoice uuid;
  settled bigint;
begin
  -- OLD is unassigned on INSERT, so it cannot be read unconditionally.
  if tg_op = 'INSERT' then
    target_invoice := new.invoice_id;
  else
    target_invoice := old.invoice_id;
  end if;

  if target_invoice is not null
     and exists (select 1 from public.invoices where id = target_invoice) then
    select coalesce(sum(p.amount_paisa), 0) into settled
    from public.payments p
    where p.invoice_id = target_invoice;

    update public.invoices i
       set paid_paisa = settled,
           status = (case
             when i.status = 'void' then 'void'
             when settled >= i.total_paisa then 'paid'
             when settled <= 0 then 'unpaid'
             else 'partial'
           end)::public.invoice_status
     where i.id = target_invoice;
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  return old;
end;
$$;

revoke execute on function public.sync_invoice_totals() from public, anon, authenticated;

create trigger payments_sync_invoice
  after insert or delete on public.payments
  for each row execute function public.sync_invoice_totals();
