-- Membership history. Append-only: a renewal inserts a row and links back to the
-- one it followed. The financial shape of a row -- who, which plan, what price,
-- when it started -- never changes after insert. Only lifecycle columns move.

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  branch_id uuid not null,
  member_id uuid not null,
  plan_id uuid not null,

  -- Snapshot of the plan as sold. Plans get renamed and repriced; a membership
  -- must still say what the member actually bought.
  plan_name text not null,
  plan_type public.plan_type not null,

  start_date date not null,
  end_date date,
  sessions_total integer check (sessions_total is null or sessions_total > 0),
  sessions_remaining integer check (sessions_remaining is null or sessions_remaining >= 0),

  price_paisa bigint not null check (price_paisa >= 0),
  discount_paisa bigint not null default 0 check (discount_paisa >= 0),

  status public.membership_status not null default 'active',
  frozen_on date,
  frozen_days integer not null default 0 check (frozen_days >= 0),
  cancelled_at timestamptz,
  cancel_reason text,

  previous_membership_id uuid references public.memberships (id) on delete set null,
  sold_by uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, org_id),

  constraint memberships_branch_fkey
    foreign key (branch_id, org_id)
    references public.branches (id, org_id) on delete restrict,

  constraint memberships_member_fkey
    foreign key (member_id, org_id)
    references public.members (id, org_id) on delete cascade,

  constraint memberships_plan_fkey
    foreign key (plan_id, org_id)
    references public.membership_plans (id, org_id) on delete restrict,

  constraint memberships_sold_by_fkey
    foreign key (sold_by, org_id)
    references public.staff (id, org_id) on delete set null,

  constraint memberships_discount_within_price
    check (discount_paisa <= price_paisa),

  constraint memberships_dates_ordered
    check (end_date is null or end_date >= start_date),

  -- A time membership always has an end date. A session pack always carries a
  -- session balance, and may also have a validity window.
  constraint memberships_shape check (
    (plan_type = 'time'
      and end_date is not null
      and sessions_total is null
      and sessions_remaining is null)
    or (plan_type = 'session_pack'
      and sessions_total is not null
      and sessions_remaining is not null
      and sessions_remaining <= sessions_total)
  ),

  constraint memberships_frozen_has_date
    check (status <> 'frozen' or frozen_on is not null),

  constraint memberships_cancelled_has_timestamp
    check (status <> 'cancelled' or cancelled_at is not null)
);

create index memberships_org_idx on public.memberships (org_id);
create index memberships_member_idx on public.memberships (member_id, start_date desc);
create index memberships_branch_idx on public.memberships (org_id, branch_id);
create index memberships_expiry_idx
  on public.memberships (org_id, end_date)
  where status in ('active', 'upcoming');
create index memberships_status_idx on public.memberships (org_id, status);

create trigger memberships_set_updated_at
  before update on public.memberships
  for each row execute function public.set_updated_at();

-- The append-only rule, enforced where it matters. Lifecycle columns (status,
-- sessions_remaining, end_date under a freeze, notes) still move; the record of
-- what was sold does not.
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
     or new.start_date is distinct from old.start_date
     or new.plan_type is distinct from old.plan_type
     or new.sessions_total is distinct from old.sessions_total
     or new.created_at is distinct from old.created_at then
    raise exception 'Membership history is append-only: sell a new membership instead of rewriting %', old.id
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_membership_immutability() from public, anon, authenticated;

create trigger memberships_guard_immutability
  before update on public.memberships
  for each row execute function public.guard_membership_immutability();

-- Nothing financial is deleted. The org and member cascades are the exception:
-- when the parent is on its way out there is no history left to protect.
create or replace function public.guard_financial_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.orgs where id = old.org_id) then
    return old;
  end if;

  if not exists (select 1 from public.members where id = old.member_id) then
    return old;
  end if;

  raise exception 'Financial history is append-only: % rows cannot be deleted', tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

revoke execute on function public.guard_financial_delete() from public, anon, authenticated;

create trigger memberships_guard_delete
  before delete on public.memberships
  for each row execute function public.guard_financial_delete();

create trigger memberships_audit
  after insert or update or delete on public.memberships
  for each row execute function public.audit_row();

alter table public.memberships enable row level security;
