-- Fees become their own catalogue.
--
-- Until now the one-off joining charge was a column on the plan
-- (signup_fee_paisa) and a list price on the org. The owner wants to define
-- fees himself -- Registration, Card, and whatever comes next (locker, towel) --
-- give each an amount and a rule, and say which plans carry it, all of them or
-- a chosen few. Each fee prints on its own invoice line.
--
-- Three pieces:
--
--   fees              what the gym can charge. One amount per fee, applied to
--                     every plan it is assigned to. Deactivated, never deleted.
--   membership_fees   what a given sale actually charged and did not charge,
--                     written by renew_membership and never changed. This is
--                     the invoice's fee lines. It is a snapshot for the same
--                     reason memberships.signup_fee_paisa is: a plan or a fee
--                     may be repriced later, and a wrong number on a tax
--                     document is worse than a missing one.
--   sale_fees()       the one definition of the fee arithmetic. The two apps
--                     mirror it; the RPC calls it.
--
-- orgs.fee_catalogue_enabled switches an org from the legacy fee (the plan's
-- signup_fee_paisa) to this catalogue. It exists so that nothing changes for
-- anyone until the apps in staff hands know about fees: a counter that quotes
-- price + catalogue fees against an RPC that charges the legacy fee, or the
-- other way round, is off by the fee. Default false. This migration changes no
-- behaviour on its own.

create type public.fee_charge_rule as enum ('once', 'every_sale');

create table public.fees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),

  -- once:       charged on the member's first membership, and shown as taken
  --             back off on every later one.
  -- every_sale: charged on every sale; there is nothing to take off.
  charge_rule public.fee_charge_rule not null default 'once',
  amount_paisa bigint not null check (amount_paisa > 0),

  -- A fee reaches a plan either because it is on for all plans -- which also
  -- covers a plan created tomorrow -- or because the plan is listed. Same shape
  -- as membership_plans.branch_ids.
  all_plans boolean not null default false,
  plan_ids uuid[] not null default '{}'::uuid[],

  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, org_id)
);

create unique index fees_org_name_key on public.fees (org_id, lower(name));
create index fees_org_active_idx on public.fees (org_id, is_active);

comment on table public.fees is
  'The gym''s one-off and recurring charges beyond the plan price. Owner-managed; deactivated, never deleted, so a past sale''s fee line still has its source.';
comment on column public.fees.plan_ids is
  'Plans this fee applies to. Ignored (and forced empty) when all_plans is true.';

create trigger fees_set_updated_at
  before update on public.fees
  for each row execute function public.set_updated_at();

-- plan_ids is an array, so no foreign key can cover it. Same substitute
-- membership_plans uses for branch_ids: every listed plan must belong to the
-- fee's own org, or a fee could be pointed at another gym's plan.
create or replace function public.validate_fee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  foreign_plans integer;
begin
  new.name := btrim(new.name);

  if new.all_plans then
    new.plan_ids := '{}'::uuid[];
  else
    -- A plan listed twice is one plan.
    new.plan_ids := coalesce(
      (select array_agg(distinct pid) from unnest(new.plan_ids) as pid),
      '{}'::uuid[]
    );
  end if;

  select count(*) into foreign_plans
  from unnest(new.plan_ids) as pid
  where not exists (
    select 1
    from public.membership_plans p
    where p.id = pid
      and p.org_id = new.org_id
  );

  if foreign_plans > 0 then
    raise exception 'plan_ids contains % plan(s) outside org %', foreign_plans, new.org_id
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_fee() from public, anon, authenticated;

create trigger fees_validate
  before insert or update on public.fees
  for each row execute function public.validate_fee();

-- Plans are retired, not deleted, so this is for org teardown and for the
-- odd test that deletes one: a fee must not keep a dangling plan id.
create or replace function public.prune_fee_plan_ids()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.fees f
  set plan_ids = array_remove(f.plan_ids, old.id)
  where f.org_id = old.org_id
    and old.id = any (f.plan_ids);

  return old;
end;
$$;

revoke execute on function public.prune_fee_plan_ids() from public, anon, authenticated;

create trigger membership_plans_prune_fees
  after delete on public.membership_plans
  for each row execute function public.prune_fee_plan_ids();

create trigger fees_audit
  after insert or update or delete on public.fees
  for each row execute function public.audit_row();

alter table public.fees enable row level security;

-- Every seller has to read the catalogue to quote a sale; only the owner
-- prices the gym. No delete policy: a fee is deactivated.
create policy "staff read fees in their org"
  on public.fees for select
  using (public.is_org_member(org_id) and public.jwt_is_staff());

create policy "owners create fees"
  on public.fees for insert
  with check (public.is_org_member(org_id) and public.jwt_is_owner());

create policy "owners update fees"
  on public.fees for update
  using (public.is_org_member(org_id) and public.jwt_is_owner())
  with check (public.is_org_member(org_id) and public.jwt_is_owner());


-- MEMBERSHIP FEES ---------------------------------------------------------------
-- What one sale charged, and what it would have charged but did not. Written
-- once by renew_membership, in the same transaction as the membership and its
-- invoice, and never edited: a correction to a sale is a new sale.

create table public.membership_fees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  membership_id uuid not null,

  -- Null once the fee row is gone (org teardown only); the name below is what
  -- the invoice prints, so the line survives either way.
  fee_id uuid,

  name text not null check (length(btrim(name)) >= 1),
  charge_rule public.fee_charge_rule not null,

  -- Included in memberships.price_paisa and in the invoice subtotal.
  charged_paisa bigint not null default 0 check (charged_paisa >= 0),
  -- Memo only: a once-fee the member already paid, shown as taken back off.
  -- Outside the subtotal and the total, like memberships.signup_fee_waived_paisa.
  waived_paisa bigint not null default 0 check (waived_paisa >= 0),

  sort_order integer not null default 0,
  created_at timestamptz not null default now(),

  constraint membership_fees_has_amount check (charged_paisa > 0 or waived_paisa > 0),
  constraint membership_fees_charged_xor_waived check (not (charged_paisa > 0 and waived_paisa > 0)),
  constraint membership_fees_waiver_is_once check (waived_paisa = 0 or charge_rule = 'once'),

  unique (membership_id, name),

  constraint membership_fees_membership_fkey
    foreign key (membership_id, org_id)
    references public.memberships (id, org_id) on delete cascade,
  constraint membership_fees_fee_fkey
    foreign key (fee_id, org_id)
    references public.fees (id, org_id) on delete set null (fee_id)
);

create index membership_fees_membership_idx on public.membership_fees (membership_id);
create index membership_fees_org_idx on public.membership_fees (org_id);

comment on table public.membership_fees is
  'Per-sale snapshot of the fees a membership charged and did not charge. Immutable. The invoice''s fee lines are read from here, never recomputed from fees.';

-- Immutable. Two doors stay open, both for the database tidying itself and
-- neither reachable from the apps: the cascade when a membership (or its org)
-- is deleted, and the foreign key nulling fee_id when a fee row is deleted.
create or replace function public.guard_membership_fees()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.orgs where id = old.org_id)
       or not exists (select 1 from public.memberships where id = old.membership_id) then
      return old;
    end if;

    raise exception 'Financial history is append-only: membership_fees rows cannot be deleted'
      using errcode = 'insufficient_privilege';
  end if;

  -- UPDATE: only the foreign key may null fee_id, and nothing else may differ.
  if new.fee_id is null
     and old.fee_id is not null
     and (to_jsonb(new) - 'fee_id') = (to_jsonb(old) - 'fee_id') then
    return new;
  end if;

  raise exception 'Financial history is append-only: membership_fees rows cannot be changed'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke execute on function public.guard_membership_fees() from public, anon, authenticated;

create trigger membership_fees_guard
  before update or delete on public.membership_fees
  for each row execute function public.guard_membership_fees();

create trigger membership_fees_audit
  after insert or update or delete on public.membership_fees
  for each row execute function public.audit_row();

alter table public.membership_fees enable row level security;

create policy "staff read membership fees in their org"
  on public.membership_fees for select
  using (public.is_org_member(org_id) and public.jwt_is_staff());

-- renew_membership is SECURITY INVOKER, so this is what lets it write. The
-- membership it points at must be one the caller may sell at.
create policy "member-facing staff write membership fees with the sale"
  on public.membership_fees for insert
  with check (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and exists (
      select 1
      from public.memberships m
      where m.id = membership_id
        and m.org_id = membership_fees.org_id
        and public.has_branch_access(m.branch_id)
    )
  );
-- No update or delete policy: immutable.


-- THE SWITCH --------------------------------------------------------------------
alter table public.orgs
  add column fee_catalogue_enabled boolean not null default false;

comment on column public.orgs.fee_catalogue_enabled is
  'When true renew_membership charges from the fees catalogue and records membership_fees; when false it charges the plan''s legacy signup_fee_paisa. Flip it only once every staff device runs an app that reads fees. Setting it back to false is the rollback.';


-- THE ARITHMETIC ----------------------------------------------------------------
-- Which fees a sale of one plan carries, and what each does to the bill. The
-- single database definition: renew_membership calls it, and the web console
-- and the Flutter app mirror it for the counter's quote, so a change here is a
-- change in three places.
--
--   charged: the amount goes into the subtotal. A once-fee on the member's
--            first membership; an every_sale fee always.
--   waived:  a once-fee that applied but was not charged because the member
--            has paid it before. Shown as taken back off; nothing is invented
--            for a fee the plan does not carry.
create or replace function public.sale_fees(
  p_plan_id uuid,
  p_is_first boolean
)
returns table (
  fee_id uuid,
  name text,
  charge_rule public.fee_charge_rule,
  charged_paisa bigint,
  waived_paisa bigint,
  sort_order integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    f.id,
    f.name,
    f.charge_rule,
    case when f.charge_rule = 'every_sale' or p_is_first then f.amount_paisa else 0 end::bigint,
    case when f.charge_rule = 'once' and not p_is_first then f.amount_paisa else 0 end::bigint,
    (row_number() over (order by f.sort_order, f.name) - 1)::integer
  from public.fees f
  join public.membership_plans p on p.id = p_plan_id and p.org_id = f.org_id
  where f.is_active
    and (f.all_plans or p.id = any (f.plan_ids))
  order by f.sort_order, f.name;
$$;

revoke execute on function public.sale_fees(uuid, boolean) from public, anon;
grant execute on function public.sale_fees(uuid, boolean) to authenticated;
