-- Phase 2 — front desk. One row per visit.
--
-- Attendance is the only table a member touches every single day, so it is
-- written to far more often than it is read. It carries a snapshot of what the
-- desk saw at the moment of entry (membership status, days to expiry, dues)
-- because that is the evidence a manager wants three months later when a member
-- disputes being turned away — recomputing it from today's memberships would
-- quietly rewrite history.

create type public.attendance_method as enum ('manual', 'qr', 'card', 'biometric');

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  branch_id uuid not null,
  member_id uuid not null,
  membership_id uuid,

  method public.attendance_method not null default 'manual',

  -- checked_in_at is the instant; attended_on is that instant expressed in the
  -- org's own timezone. Same-day dedupe has to reason in gym-local days, and a
  -- date_trunc over a timestamptz cannot be indexed without pinning the zone.
  checked_in_at timestamptz not null default now(),
  attended_on date not null,
  checked_out_at timestamptz,

  -- What the desk was shown. Snapshot, never recomputed.
  membership_status_at_checkin public.membership_status,
  days_to_expiry_at_checkin integer,
  due_paisa_at_checkin bigint not null default 0,

  -- A second visit on the same day is allowed only as a deliberate override, so
  -- a double-tap on the check-in button cannot inflate the attendance numbers.
  is_override boolean not null default false,
  override_reason text,

  checked_in_by uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint attendance_id_org_id_key unique (id, org_id),

  constraint attendance_branch_fkey
    foreign key (branch_id, org_id) references public.branches (id, org_id)
    deferrable initially deferred,
  constraint attendance_member_fkey
    foreign key (member_id, org_id) references public.members (id, org_id)
    on delete cascade,
  constraint attendance_membership_fkey
    foreign key (membership_id, org_id) references public.memberships (id, org_id)
    on delete set null,
  constraint attendance_checked_in_by_fkey
    foreign key (checked_in_by, org_id) references public.staff (id, org_id)
    on delete set null,

  constraint attendance_checkout_after_checkin
    check (checked_out_at is null or checked_out_at >= checked_in_at),
  constraint attendance_override_needs_reason
    check (
      not is_override
      or length(btrim(coalesce(override_reason, ''))) > 0
    ),
  constraint attendance_due_paisa_check check (due_paisa_at_checkin >= 0)
);

-- One ordinary check-in per member per gym-day. Overrides sit outside the index
-- so the desk can still let someone back in after lunch, on the record.
create unique index attendance_one_per_member_per_day
  on public.attendance (member_id, attended_on)
  where not is_override;

-- The check-in screen, the daily sheet and the HQ roll-up all filter by branch
-- and day; the member profile reads one member's history newest first.
create index attendance_branch_day_idx
  on public.attendance (org_id, branch_id, attended_on desc);
create index attendance_member_recent_idx
  on public.attendance (member_id, checked_in_at desc);

-- "In the gym now" is a hot, tiny slice: today's open visits for one branch.
create index attendance_open_visits_idx
  on public.attendance (branch_id, attended_on)
  where checked_out_at is null;

-- Fills the derived columns so no caller has to know the org timezone, and so
-- attended_on can never disagree with checked_in_at.
create or replace function public.prepare_attendance_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.checked_in_at is null then
    new.checked_in_at := now();
  end if;

  new.attended_on := (
    new.checked_in_at at time zone coalesce(
      (select o.timezone from public.orgs o where o.id = new.org_id),
      'Asia/Kathmandu'
    )
  )::date;

  if not new.is_override then
    new.override_reason := null;
  end if;

  return new;
end;
$$;

-- Attendance is not financial, but it is evidence. Nobody rewrites when a
-- member arrived; check-out and notes are the only fields that move.
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

create trigger attendance_prepare_row
  before insert or update on public.attendance
  for each row execute function public.prepare_attendance_row();

create trigger attendance_guard_immutability
  before update on public.attendance
  for each row execute function public.guard_attendance_immutability();

create trigger attendance_set_updated_at
  before update on public.attendance
  for each row execute function public.set_updated_at();

create trigger attendance_audit
  after insert or delete or update on public.attendance
  for each row execute function public.audit_row();

-- RLS ------------------------------------------------------------------------
alter table public.attendance enable row level security;

-- Read is org-wide, matching members: a chain member can train at any branch and
-- their history has to read as one story on the profile screen.
create policy "staff read attendance in their org"
  on public.attendance for select to authenticated
  using (public.is_org_member(org_id));

-- Writing a check-in is a front-desk act, at the desk you actually work.
create policy "member-facing staff check members in"
  on public.attendance for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and public.has_branch_access(branch_id)
    and (checked_in_by = public.jwt_staff_id() or public.jwt_is_owner())
  );

create policy "member-facing staff check members out"
  on public.attendance for update to authenticated
  using (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and public.has_branch_access(branch_id)
  )
  with check (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and public.has_branch_access(branch_id)
  );

-- Deleting attendance erases the churn signal. Owners only, and the UI never
-- offers it.
create policy "owners delete attendance"
  on public.attendance for delete to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_owner());

-- Grants: these are triggers, not RPCs. Nothing outside the table should be
-- able to call them.
revoke execute on function public.prepare_attendance_row() from public, anon, authenticated;
revoke execute on function public.guard_attendance_immutability() from public, anon, authenticated;
