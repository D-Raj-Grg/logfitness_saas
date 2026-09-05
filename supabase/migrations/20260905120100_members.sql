-- The member record. Members do not authenticate in v1; auth_user_id stays null
-- until the Flutter app links a phone-OTP account to an existing record.

create table public.members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  home_branch_id uuid not null,
  auth_user_id uuid unique references auth.users (id) on delete set null,
  member_code text not null,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  phone text not null check (length(btrim(phone)) between 5 and 32),
  email text check (email is null or position('@' in email) > 1),
  date_of_birth date check (date_of_birth is null or date_of_birth > date '1900-01-01'),
  gender public.member_gender,
  address text,
  photo_path text,
  emergency_contact_name text,
  emergency_contact_phone text,
  notes text,
  status public.member_status not null default 'expired',
  joined_on date not null,
  left_on date,
  left_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Phone is the identity anchor in this market; national ID is not reliably
  -- collected. One phone, one member, per org.
  unique (org_id, phone),
  unique (org_id, member_code),

  -- Pins the home branch to the member's own org.
  constraint members_home_branch_fkey
    foreign key (home_branch_id, org_id)
    references public.branches (id, org_id) on delete restrict,

  constraint members_created_by_fkey
    foreign key (created_by, org_id)
    references public.staff (id, org_id) on delete set null,

  constraint members_left_on_requires_left_status
    check (status <> 'left' or left_on is not null)
);

create index members_org_id_idx on public.members (org_id);
create index members_home_branch_idx on public.members (org_id, home_branch_id);
create index members_status_idx on public.members (org_id, status);
create index members_auth_user_id_idx on public.members (auth_user_id);

-- Front-desk search is by phone or name and must feel instant. Phone gets a
-- prefix index; name gets trigram matching so "raj" finds "Raj Bahadur".
create extension if not exists pg_trgm with schema extensions;

create index members_phone_prefix_idx
  on public.members (org_id, phone text_pattern_ops);

create index members_full_name_trgm_idx
  on public.members using gin (full_name extensions.gin_trgm_ops);

create index members_member_code_prefix_idx
  on public.members (org_id, member_code text_pattern_ops);

create trigger members_set_updated_at
  before update on public.members
  for each row execute function public.set_updated_at();

-- Normalises the fields the front desk types by hand, and mints the member code
-- on insert. Codes are never reassigned, even if a member is deleted.
create or replace function public.prepare_member_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.full_name := btrim(new.full_name);
  new.phone := btrim(new.phone);
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');

  if tg_op = 'INSERT' then
    if new.joined_on is null then
      new.joined_on := public.org_today(new.org_id);
    end if;

    if new.member_code is null or btrim(new.member_code) = '' then
      new.member_code := 'M' || lpad(
        public.next_org_counter(new.org_id, 'member')::text, 5, '0'
      );
    end if;
  else
    -- The code is printed on cards and quoted over the phone. It does not move.
    new.member_code := old.member_code;
    new.org_id := old.org_id;
  end if;

  return new;
end;
$$;

revoke execute on function public.prepare_member_row() from public, anon, authenticated;

-- joined_on and member_code are declared not null but may be omitted by the
-- caller: NOT NULL is checked after BEFORE ROW triggers, and this one fills them.
create trigger members_prepare_row
  before insert or update on public.members
  for each row execute function public.prepare_member_row();

create trigger members_audit
  after insert or update or delete on public.members
  for each row execute function public.audit_row();

alter table public.members enable row level security;
