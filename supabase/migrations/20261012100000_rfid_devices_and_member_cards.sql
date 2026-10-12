-- RFID check-in, part 1 -- the tables. A door reader (ESP32 + RC522) is a
-- `devices` row bound to one branch; a member's physical card is a
-- `member_cards` row; a card the reader has never seen lands in
-- `unassigned_card_scans` so the desk can hand it to a member from the profile
-- screen. Attendance learns which device let someone in.
--
-- A device is not a person and never holds a JWT. It authenticates with a
-- random key that the rfid-check Edge Function hashes (sha256) and hands to
-- rfid_check_in() as the only thing it knows. The plaintext key is shown to
-- the owner once, at register/rotate time, and never stored.
--
-- Audit note: devices carries the audit_row trigger, so audit_log.after holds
-- key_hash. That is the sha256 of 256 random bits -- useless to anyone who
-- reads it, since the Edge Function only accepts the plaintext key. Accepted
-- deliberately rather than special-casing audit_row for one table. The audit
-- trigger fires only on the columns a human changes, not on last_seen_at,
-- so a busy door does not write an audit row per tap.

create type public.device_status as enum ('active', 'disabled');

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  branch_id uuid not null,
  name text not null,
  key_hash text not null,
  key_prefix text not null,
  status public.device_status not null default 'active',
  last_seen_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint devices_id_org_id_key unique (id, org_id),
  constraint devices_org_id_name_key unique (org_id, name),
  constraint devices_key_hash_key unique (key_hash),
  constraint devices_name_check
    check (length(btrim(name)) between 1 and 60),
  constraint devices_branch_fkey
    foreign key (branch_id, org_id) references public.branches (id, org_id)
    on delete cascade,
  constraint devices_created_by_fkey
    foreign key (created_by, org_id) references public.staff (id, org_id)
    on delete set null (created_by)
);

create index devices_branch_id_idx on public.devices (org_id, branch_id);

comment on table public.devices is
  'RFID readers. Written only through register_device / rotate_device_key / update_device (security definer); staff read their org''s rows.';
comment on column public.devices.key_hash is
  'Hex sha256 of the device key. The plaintext is returned once by register_device/rotate_device_key and never stored.';
comment on column public.devices.key_prefix is
  'First characters of the plaintext key, so an owner can tell which key a reader is flashed with.';

-- ---------------------------------------------------------------------------
-- member_cards -- one live card per member, one live member per card. History
-- is kept: a lost or replaced card is revoked with a reason, never deleted, so
-- "who was holding this card in March" stays answerable.

create table public.member_cards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  member_id uuid not null,
  card_uid text not null,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint member_cards_card_uid_check
    check (card_uid ~ '^[0-9A-F]{8,20}$'),
  constraint member_cards_revoke_needs_reason
    check (
      revoked_at is null
      or length(btrim(coalesce(revoke_reason, ''))) > 0
    ),
  constraint member_cards_member_fkey
    foreign key (member_id, org_id) references public.members (id, org_id)
    on delete cascade,
  constraint member_cards_assigned_by_fkey
    foreign key (assigned_by, org_id) references public.staff (id, org_id)
    on delete set null (assigned_by),
  constraint member_cards_revoked_by_fkey
    foreign key (revoked_by, org_id) references public.staff (id, org_id)
    on delete set null (revoked_by)
);

create unique index member_cards_live_uid_key
  on public.member_cards (org_id, card_uid)
  where revoked_at is null;
create unique index member_cards_live_member_key
  on public.member_cards (member_id)
  where revoked_at is null;

comment on table public.member_cards is
  'RFID card assignments. At most one live (unrevoked) card per member and per card UID within an org. Revoked rows are history.';
comment on column public.member_cards.card_uid is
  'Card UID as uppercase hex, no separators.';

-- A card assignment is evidence of who held a card when. The only change ever
-- allowed is revoking it, once.
create or replace function public.guard_member_card_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.org_id is distinct from old.org_id
     or new.member_id is distinct from old.member_id
     or new.card_uid is distinct from old.card_uid
     or new.assigned_by is distinct from old.assigned_by
     or new.assigned_at is distinct from old.assigned_at
     or new.created_at is distinct from old.created_at
  then
    raise exception 'A card assignment is immutable; revoke it and assign a new one'
      using errcode = 'restrict_violation';
  end if;

  if (old.revoked_at is not null or new.revoked_at is null)
     and (
       new.revoked_at is distinct from old.revoked_at
       or new.revoked_by is distinct from old.revoked_by
       or new.revoke_reason is distinct from old.revoke_reason
     )
  then
    raise exception 'A card can be revoked once and never un-revoked'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger member_cards_guard_immutability
  before update on public.member_cards
  for each row execute function public.guard_member_card_immutability();

create trigger member_cards_set_updated_at
  before update on public.member_cards
  for each row execute function public.set_updated_at();

create trigger member_cards_audit
  after insert or delete or update on public.member_cards
  for each row execute function public.audit_row();

create trigger devices_set_updated_at
  before update on public.devices
  for each row execute function public.set_updated_at();

create trigger devices_audit
  after insert or delete or update of branch_id, name, key_hash, key_prefix, status
  on public.devices
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- unassigned_card_scans -- the enrollment inbox. One row per (reader, card),
-- bumped on every tap, pruned after a week by rfid_check_in itself.

create table public.unassigned_card_scans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  branch_id uuid not null,
  device_id uuid not null,
  card_uid text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  scan_count integer not null default 1,

  constraint unassigned_card_scans_device_card_key unique (device_id, card_uid),
  constraint unassigned_card_scans_card_uid_check
    check (card_uid ~ '^[0-9A-F]{8,20}$'),
  constraint unassigned_card_scans_scan_count_check check (scan_count >= 1),
  constraint unassigned_card_scans_branch_fkey
    foreign key (branch_id, org_id) references public.branches (id, org_id)
    on delete cascade,
  constraint unassigned_card_scans_device_fkey
    foreign key (device_id, org_id) references public.devices (id, org_id)
    on delete cascade
);

create index unassigned_card_scans_branch_recent_idx
  on public.unassigned_card_scans (org_id, branch_id, last_seen_at desc);
create index unassigned_card_scans_org_uid_idx
  on public.unassigned_card_scans (org_id, card_uid);

comment on table public.unassigned_card_scans is
  'Cards tapped on a reader that belong to no member yet. Written only by rfid_check_in (security definer); staff read and clear rows for branches they can reach.';

-- ---------------------------------------------------------------------------
-- attendance learns which reader let a member in. A device check-in has no
-- human behind it, so checked_in_by stays null there; owner check-ins can be
-- null too, which is why there is no "exactly one of" check here.

alter table public.attendance
  add column device_id uuid,
  add constraint attendance_device_fkey
    foreign key (device_id, org_id) references public.devices (id, org_id)
    on delete set null (device_id);

create index attendance_device_id_idx
  on public.attendance (device_id)
  where device_id is not null;

-- Re-created to add device_id: which reader let someone in is part of the
-- evidence, same as who at the desk did.
create or replace function public.guard_attendance_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.org_id is distinct from old.org_id
     or new.member_id is distinct from old.member_id
     or new.branch_id is distinct from old.branch_id
     or new.checked_in_at is distinct from old.checked_in_at
     or new.attended_on is distinct from old.attended_on
     or new.method is distinct from old.method
     or new.checked_in_by is distinct from old.checked_in_by
     or new.device_id is distinct from old.device_id
     or new.membership_status_at_checkin is distinct from old.membership_status_at_checkin
     or new.days_to_expiry_at_checkin is distinct from old.days_to_expiry_at_checkin
     or new.due_paisa_at_checkin is distinct from old.due_paisa_at_checkin
  then
    raise exception 'A check-in record is immutable; only check-out and notes may change'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

-- RLS ------------------------------------------------------------------------
alter table public.devices enable row level security;
alter table public.member_cards enable row level security;
alter table public.unassigned_card_scans enable row level security;

create policy "staff read devices in their org"
  on public.devices for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

-- No write policies on devices: every write goes through the definer RPCs in
-- the next migration, which own the key generation and the role check.

create policy "staff read member cards in their org"
  on public.member_cards for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

create policy "member-facing staff assign cards"
  on public.member_cards for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and assigned_by = public.jwt_staff_id()
  );

-- Any member-facing staff can revoke a card, not only whoever assigned it --
-- the person reporting a lost card rarely meets the same desk twice. The
-- revoker signs the revocation.
create policy "member-facing staff revoke cards"
  on public.member_cards for update to authenticated
  using (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
  )
  with check (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and revoked_by = public.jwt_staff_id()
  );

-- No delete policy: revoked rows are the history.

create policy "staff read unassigned scans at their branches"
  on public.unassigned_card_scans for select to authenticated
  using (
    public.is_org_member(org_id)
    and public.jwt_is_staff()
    and public.has_branch_access(branch_id)
  );

create policy "staff clear unassigned scans at their branches"
  on public.unassigned_card_scans for delete to authenticated
  using (
    public.is_org_member(org_id)
    and public.jwt_is_staff()
    and public.has_branch_access(branch_id)
  );

-- No insert/update policy: only rfid_check_in writes scans.

-- ---------------------------------------------------------------------------
-- attendance_detail: same columns, same order, plus the reader. security_invoker
-- keeps devices RLS in force, so a non-staff reader just sees a null name.
create or replace view public.attendance_detail
with (security_invoker = true)
as
select
  a.id,
  a.org_id,
  a.branch_id,
  b.name as branch_name,
  a.member_id,
  m.member_code,
  m.full_name,
  m.phone,
  m.photo_path,
  a.membership_id,
  a.method,
  a.checked_in_at,
  a.checked_out_at,
  a.attended_on,
  a.membership_status_at_checkin,
  a.days_to_expiry_at_checkin,
  a.due_paisa_at_checkin,
  a.is_override,
  a.override_reason,
  a.checked_in_by,
  s.full_name as checked_in_by_name,
  a.notes,
  a.device_id,
  dv.name as device_name
from public.attendance a
join public.branches b on b.id = a.branch_id
join public.members m on m.id = a.member_id
left join public.staff s on s.id = a.checked_in_by
left join public.devices dv on dv.id = a.device_id;

revoke all on public.attendance_detail from public, anon;
grant select on public.attendance_detail to authenticated;

-- Grants: these are triggers, not RPCs.
revoke execute on function public.guard_member_card_immutability() from public, anon, authenticated;
revoke execute on function public.guard_attendance_immutability() from public, anon, authenticated;
