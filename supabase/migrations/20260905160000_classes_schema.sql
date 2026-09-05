-- Phase 4 -- Classes. Schema for the timetable: a class is a recurring offering
-- (spin, yoga, whatever the gym runs on a schedule); a class_session is one
-- concrete occurrence on the calendar; a class_booking is one member's seat on
-- one session. The pg_cron job that materializes sessions from recurrence 60
-- days out is a separate, later task -- this migration only shapes the data it
-- will write into.

create type public.class_session_status as enum ('scheduled', 'cancelled');
create type public.class_booking_status as enum (
  'booked', 'waitlisted', 'cancelled', 'attended', 'no_show'
);

-- Validates the recurrence shape a pg_cron materializer will read later: an
-- array of {day_of_week (0=Sunday..6=Saturday), start_time, end_time}. Kept as
-- a standalone function, not inlined into the check constraint, so the
-- materializer and any future UI validation can reuse the same rule.
create or replace function public.validate_class_recurrence(p_recurrence jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  elem jsonb;
  d int;
  st time;
  et time;
begin
  if p_recurrence is null or jsonb_typeof(p_recurrence) <> 'array' then
    return false;
  end if;

  for elem in select value from jsonb_array_elements(p_recurrence) as t(value) loop
    begin
      d := (elem ->> 'day_of_week')::int;
      st := (elem ->> 'start_time')::time;
      et := (elem ->> 'end_time')::time;
    exception when others then
      return false;
    end;

    if d is null or d < 0 or d > 6 or st is null or et is null or st >= et then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke execute on function public.validate_class_recurrence(jsonb) from public, anon;
grant execute on function public.validate_class_recurrence(jsonb) to authenticated;

-- CLASSES ---------------------------------------------------------------------

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  branch_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text,
  trainer_id uuid,
  capacity integer not null check (capacity > 0),
  room text,
  -- [{ "day_of_week": 1, "start_time": "18:00", "end_time": "19:00" }, ...].
  -- This is the shape the (separate, later) pg_cron materializer reads to
  -- generate class_sessions 60 days ahead. Not itself a schedule of sessions.
  recurrence jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint classes_id_org_id_key unique (id, org_id),

  constraint classes_branch_fkey
    foreign key (branch_id, org_id) references public.branches (id, org_id)
    deferrable initially deferred,
  constraint classes_trainer_fkey
    foreign key (trainer_id, org_id) references public.staff (id, org_id)
    on delete set null,

  constraint classes_recurrence_shape
    check (public.validate_class_recurrence(recurrence))
);

create index classes_org_branch_idx on public.classes (org_id, branch_id);
create index classes_trainer_idx on public.classes (org_id, trainer_id);

create trigger classes_set_updated_at
  before update on public.classes
  for each row execute function public.set_updated_at();

create trigger classes_audit
  after insert or update or delete on public.classes
  for each row execute function public.audit_row();

alter table public.classes enable row level security;

-- CLASS SESSIONS ----------------------------------------------------------------
-- One concrete occurrence. capacity and trainer_id are snapshots taken when the
-- session is created -- editing the parent class later (a new trainer, a bigger
-- room) does not rewrite sessions already on the calendar.

create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  branch_id uuid not null,
  class_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity > 0),
  trainer_id uuid,
  status public.class_session_status not null default 'scheduled',
  -- Maintained by a trigger on class_bookings; never written directly.
  booked_count integer not null default 0 check (booked_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint class_sessions_id_org_id_key unique (id, org_id),

  constraint class_sessions_class_fkey
    foreign key (class_id, org_id) references public.classes (id, org_id)
    on delete cascade,
  constraint class_sessions_branch_fkey
    foreign key (branch_id, org_id) references public.branches (id, org_id)
    deferrable initially deferred,
  constraint class_sessions_trainer_fkey
    foreign key (trainer_id, org_id) references public.staff (id, org_id)
    on delete set null,

  constraint class_sessions_ends_after_starts check (ends_at > starts_at)
);

create index class_sessions_class_idx on public.class_sessions (class_id);
create index class_sessions_branch_starts_idx
  on public.class_sessions (org_id, branch_id, starts_at);
create index class_sessions_starts_idx on public.class_sessions (starts_at);

create trigger class_sessions_set_updated_at
  before update on public.class_sessions
  for each row execute function public.set_updated_at();

create trigger class_sessions_audit
  after insert or update or delete on public.class_sessions
  for each row execute function public.audit_row();

alter table public.class_sessions enable row level security;

-- CLASS BOOKINGS ----------------------------------------------------------------

create table public.class_bookings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  branch_id uuid not null,
  session_id uuid not null,
  member_id uuid not null,
  status public.class_booking_status not null default 'booked',
  booked_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint class_bookings_id_org_id_key unique (id, org_id),

  constraint class_bookings_session_fkey
    foreign key (session_id, org_id) references public.class_sessions (id, org_id)
    on delete cascade,
  constraint class_bookings_member_fkey
    foreign key (member_id, org_id) references public.members (id, org_id)
    on delete cascade,
  constraint class_bookings_branch_fkey
    foreign key (branch_id, org_id) references public.branches (id, org_id)
    deferrable initially deferred,

  constraint class_bookings_cancel_needs_timestamp
    check (status <> 'cancelled' or cancelled_at is not null)
);

-- A member cannot hold two live (booked or waitlisted) bookings on one
-- session. Cancelled bookings fall outside the index, so cancel-then-rebook is
-- allowed.
create unique index class_bookings_one_live_per_member
  on public.class_bookings (session_id, member_id)
  where status in ('booked', 'waitlisted');

create index class_bookings_member_idx
  on public.class_bookings (member_id, booked_at desc);
create index class_bookings_session_idx
  on public.class_bookings (session_id, status);
-- Oldest live waitlisted booking first: exactly the row cancel_class_booking
-- promotes.
create index class_bookings_waitlist_order_idx
  on public.class_bookings (session_id, booked_at)
  where status = 'waitlisted';

create trigger class_bookings_set_updated_at
  before update on public.class_bookings
  for each row execute function public.set_updated_at();

create trigger class_bookings_audit
  after insert or update or delete on public.class_bookings
  for each row execute function public.audit_row();

-- Keeps class_sessions.booked_count in lockstep with the bookings that are
-- actually holding a seat (waitlisted rows don't count against capacity).
create or replace function public.maintain_class_session_booked_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
begin
  v_session_id := coalesce(new.session_id, old.session_id);

  update public.class_sessions
     set booked_count = (
       select count(*) from public.class_bookings b
       where b.session_id = v_session_id
         and b.status = 'booked'::public.class_booking_status
     )
   where id = v_session_id;

  -- Defensive: a booking's session_id should never move, but if it ever did,
  -- keep the session it left honest too.
  if tg_op = 'UPDATE' and old.session_id is distinct from new.session_id then
    update public.class_sessions
       set booked_count = (
         select count(*) from public.class_bookings b
         where b.session_id = old.session_id
           and b.status = 'booked'::public.class_booking_status
       )
     where id = old.session_id;
  end if;

  return coalesce(new, old);
end;
$$;

revoke execute on function public.maintain_class_session_booked_count()
  from public, anon, authenticated;

create trigger class_bookings_maintain_session_count
  after insert or update or delete on public.class_bookings
  for each row execute function public.maintain_class_session_booked_count();

alter table public.class_bookings enable row level security;

-- RLS ---------------------------------------------------------------------------

-- Staff reads are org-wide, matching the other member-facing tables: a class at
-- any branch of the chain is visible to any staff member for reporting and the
-- (separate, later) timetable UI. Staff-only: member tokens now carry org_id
-- too and must not see the whole chain's timetable through this policy.
create policy "staff read classes in their org"
  on public.classes for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

create policy "staff read class sessions in their org"
  on public.class_sessions for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

create policy "staff read class bookings in their org"
  on public.class_bookings for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

-- Managing the catalogue is an owner/manager act, scoped to the branch, same
-- shape as membership_plans. This is schema plumbing for the (separate, later)
-- Class CRUD task, not that task itself -- no session or booking writes are
-- opened up for staff here; those go through class_sessions' own (later)
-- materializer and the booking RPCs below.
create policy "owners and managers create classes"
  on public.classes for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and (public.jwt_is_owner() or public.jwt_staff_role() = 'manager'::public.staff_role)
    and public.has_branch_access(branch_id)
  );

create policy "owners and managers update classes"
  on public.classes for update to authenticated
  using (
    public.is_org_member(org_id)
    and (public.jwt_is_owner() or public.jwt_staff_role() = 'manager'::public.staff_role)
    and public.has_branch_access(branch_id)
  )
  with check (
    public.is_org_member(org_id)
    and (public.jwt_is_owner() or public.jwt_staff_role() = 'manager'::public.staff_role)
    and public.has_branch_access(branch_id)
  );

create policy "owners delete classes"
  on public.classes for delete to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_owner());

-- Members read classes and sessions at their home branch only -- branch_ids on
-- a member token holds exactly that one branch.
create policy "members read classes at their branch"
  on public.classes for select to authenticated
  using (
    public.jwt_is_member()
    and public.is_org_member(org_id)
    and branch_id = any (public.jwt_branch_ids())
    and is_active
  );

create policy "members read class sessions at their branch"
  on public.class_sessions for select to authenticated
  using (
    public.jwt_is_member()
    and public.is_org_member(org_id)
    and branch_id = any (public.jwt_branch_ids())
  );

-- Members read only their own bookings. No insert/update policy exists for
-- members on this table at all -- booking and cancelling both go through the
-- security-definer RPCs, which apply their own rules and cannot be routed
-- around by a direct write even if one were attempted.
create policy "members read their own class bookings"
  on public.class_bookings for select to authenticated
  using (public.jwt_is_member() and member_id = public.jwt_member_id());
