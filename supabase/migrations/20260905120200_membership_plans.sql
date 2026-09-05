-- The plan catalogue. Plans are org-level; branch_ids narrows a plan to a subset
-- of branches, and an empty array means "sold everywhere".

create table public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text,
  plan_type public.plan_type not null,
  duration_days integer check (duration_days is null or duration_days > 0),
  session_count integer check (session_count is null or session_count > 0),
  price_paisa bigint not null check (price_paisa >= 0),
  signup_fee_paisa bigint not null default 0 check (signup_fee_paisa >= 0),
  branch_ids uuid[] not null default '{}'::uuid[],
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (org_id, name),
  unique (id, org_id),

  -- A time plan runs for a number of days. A session pack sells a count of
  -- sessions, and may additionally expire after a validity window.
  constraint membership_plans_shape check (
    (plan_type = 'time' and duration_days is not null and session_count is null)
    or (plan_type = 'session_pack' and session_count is not null)
  )
);

create index membership_plans_org_id_idx on public.membership_plans (org_id);
create index membership_plans_branch_ids_idx
  on public.membership_plans using gin (branch_ids);

create trigger membership_plans_set_updated_at
  before update on public.membership_plans
  for each row execute function public.set_updated_at();

-- branch_ids is an array, so no foreign key can cover it. Same substitute the
-- staff table uses: every listed branch must belong to the plan's own org.
create or replace function public.validate_plan_branches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  foreign_branches integer;
begin
  new.name := btrim(new.name);

  select count(*) into foreign_branches
  from unnest(new.branch_ids) as bid
  where not exists (
    select 1
    from public.branches b
    where b.id = bid
      and b.org_id = new.org_id
  );

  if foreign_branches > 0 then
    raise exception 'branch_ids contains % branch(es) outside org %',
      foreign_branches, new.org_id
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_plan_branches() from public, anon, authenticated;

create trigger membership_plans_validate_branches
  before insert or update on public.membership_plans
  for each row execute function public.validate_plan_branches();

create trigger membership_plans_audit
  after insert or update or delete on public.membership_plans
  for each row execute function public.audit_row();

alter table public.membership_plans enable row level security;

-- True when a plan may be sold at a branch. An empty branch_ids means org-wide.
create or replace function public.plan_sold_at(p_plan_id uuid, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.membership_plans p
    where p.id = p_plan_id
      and (
        coalesce(array_length(p.branch_ids, 1), 0) = 0
        or p_branch_id = any (p.branch_ids)
      )
  );
$$;

-- members gains a composite unique so memberships, invoices, and payments can
-- pin their member to the same org they carry.
alter table public.members
  add constraint members_id_org_id_key unique (id, org_id);
