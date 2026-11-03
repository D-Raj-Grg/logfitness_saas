-- Staff clock-in / clock-out.
--
-- A staff card tap at the door records the staff member's OWN attendance here.
-- It is deliberately not the members' `attendance` table: that one is one row
-- per member per day, carries membership and dues snapshots, and feeds the
-- absent report and the member screen. A trainer's shift has none of that, and
-- mixing them would have put staff in every member report.
--
-- Unlike a member, a staff member can work two shifts in a day, so there is no
-- one-per-day index. The one rule is one OPEN shift per person.
--
-- Tap semantics (staff_clock_tap):
--   * no open shift                          -> clock in
--   * open shift, tapped again < 2 min later -> no-op ("already in"); a door
--                                               double-tap must not clock out
--   * open shift, tapped again later         -> clock out
--   * open shift older than 16 h             -> the person forgot to clock out.
--                                               It is closed as auto_closed with
--                                               NO clock-out time (inventing one
--                                               would be a made-up number on a
--                                               timesheet), and this tap clocks
--                                               in. A fixed 16 h rule, not
--                                               "midnight", so a night-shift
--                                               trainer is not cut off.
-- The time is the server's, never the reader's: a reader's clock can drift.

create table public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  staff_id uuid not null,
  branch_id uuid not null,
  device_id uuid,
  clocked_in_at timestamptz not null default now(),
  clocked_out_at timestamptz,
  attended_on date not null,
  in_source text not null default 'card',
  out_source text,
  auto_closed boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),

  constraint staff_attendance_id_org_id_key unique (id, org_id),
  constraint staff_attendance_in_source_check
    check (in_source in ('card', 'offline_card', 'manual')),
  constraint staff_attendance_out_source_check
    check (out_source is null or out_source in ('card', 'offline_card', 'manual')),
  constraint staff_attendance_out_after_in
    check (clocked_out_at is null or clocked_out_at > clocked_in_at),
  -- An auto-closed shift has no clock-out by design; a closed one has a source.
  constraint staff_attendance_auto_closed_no_out
    check (not auto_closed or clocked_out_at is null),
  constraint staff_attendance_out_has_source
    check (clocked_out_at is null or out_source is not null),
  constraint staff_attendance_staff_fkey
    foreign key (staff_id, org_id) references public.staff (id, org_id)
    on delete cascade,
  constraint staff_attendance_branch_fkey
    foreign key (branch_id, org_id) references public.branches (id, org_id)
    on delete cascade,
  constraint staff_attendance_device_fkey
    foreign key (device_id, org_id) references public.devices (id, org_id)
    on delete set null (device_id)
);

create unique index staff_attendance_one_open_shift
  on public.staff_attendance (staff_id)
  where clocked_out_at is null and not auto_closed;
create index staff_attendance_staff_recent_idx
  on public.staff_attendance (staff_id, clocked_in_at desc);
create index staff_attendance_branch_day_idx
  on public.staff_attendance (org_id, branch_id, attended_on desc);

comment on table public.staff_attendance is
  'Staff clock-in/out from card taps. Written only by staff_clock_tap (security definer); read through RLS. An auto_closed row is a shift nobody clocked out of: it has no clock-out time.';

-- attended_on is the gym's calendar day, not UTC's -- same expression the
-- member attendance trigger uses -- so a 10pm shift belongs to that evening.
create or replace function public.prepare_staff_attendance_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.clocked_in_at is null then
    new.clocked_in_at := now();
  end if;

  new.attended_on := (
    new.clocked_in_at at time zone coalesce(
      (select o.timezone from public.orgs o where o.id = new.org_id),
      'Asia/Kathmandu'
    )
  )::date;

  return new;
end;
$$;

create trigger staff_attendance_prepare
  before insert on public.staff_attendance
  for each row execute function public.prepare_staff_attendance_row();

-- A time record is evidence. Only closing a shift (or noting it) may change it.
create or replace function public.guard_staff_attendance_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.org_id is distinct from old.org_id
     or new.staff_id is distinct from old.staff_id
     or new.branch_id is distinct from old.branch_id
     or new.device_id is distinct from old.device_id
     or new.clocked_in_at is distinct from old.clocked_in_at
     or new.attended_on is distinct from old.attended_on
     or new.in_source is distinct from old.in_source
     or new.created_at is distinct from old.created_at
  then
    raise exception 'A time record is immutable; only clock-out and notes may change'
      using errcode = 'restrict_violation';
  end if;

  if old.clocked_out_at is not null
     and (new.clocked_out_at is distinct from old.clocked_out_at
          or new.out_source is distinct from old.out_source)
  then
    raise exception 'A clocked-out shift cannot be changed'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger staff_attendance_guard_immutability
  before update on public.staff_attendance
  for each row execute function public.guard_staff_attendance_immutability();

-- RLS: select only. Owners read everything in the org, managers the branches
-- they cover, and anyone reads their own shifts. There is no write policy --
-- the only writer is staff_clock_tap.
alter table public.staff_attendance enable row level security;

create policy "staff read their own and their branches' time records"
  on public.staff_attendance for select to authenticated
  using (
    public.is_org_member(org_id)
    and (
      staff_id = public.jwt_staff_id()
      or (
        public.jwt_staff_role() in ('owner'::public.staff_role, 'manager'::public.staff_role)
        and public.has_branch_access(branch_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- The one writer. security definer and callable only by rfid_check_in (itself
-- service-role only), so nothing a signed-in user can reach can forge a shift.
create or replace function public.staff_clock_tap(
  p_org_id uuid,
  p_branch_id uuid,
  p_device_id uuid,
  p_staff_id uuid,
  p_source text default 'card'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open public.staff_attendance%rowtype;
  v_row public.staff_attendance%rowtype;
begin
  -- Two taps racing for the same person queue here instead of both finding "no
  -- open shift" and the unique index throwing at one of them.
  perform pg_advisory_xact_lock(hashtextextended('staff_clock:' || p_staff_id::text, 0));

  select * into v_open
  from public.staff_attendance sa
  where sa.staff_id = p_staff_id
    and sa.clocked_out_at is null
    and not sa.auto_closed
  for update;

  if found then
    if now() - v_open.clocked_in_at > interval '16 hours' then
      update public.staff_attendance sa
      set auto_closed = true
      where sa.id = v_open.id;
      -- Falls through to clock in below.
    elsif now() - v_open.clocked_in_at < interval '2 minutes' then
      return jsonb_build_object(
        'clock', 'already_in',
        'at', v_open.clocked_in_at,
        'attendance_id', v_open.id
      );
    else
      update public.staff_attendance sa
      set clocked_out_at = now(), out_source = p_source
      where sa.id = v_open.id
      returning * into v_row;

      return jsonb_build_object(
        'clock', 'out',
        'at', v_row.clocked_out_at,
        'attendance_id', v_row.id
      );
    end if;
  end if;

  insert into public.staff_attendance (
    org_id, staff_id, branch_id, device_id, in_source
  )
  values (p_org_id, p_staff_id, p_branch_id, p_device_id, p_source)
  returning * into v_row;

  return jsonb_build_object(
    'clock', 'in',
    'at', v_row.clocked_in_at,
    'attendance_id', v_row.id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- What the staff screen reads: shifts with the names on them. security_invoker,
-- so staff_attendance RLS is what scopes it.
create or replace view public.staff_attendance_detail
with (security_invoker = true)
as
select
  sa.id,
  sa.org_id,
  sa.staff_id,
  s.full_name as staff_name,
  sa.branch_id,
  b.name as branch_name,
  sa.device_id,
  dv.name as device_name,
  sa.clocked_in_at,
  sa.clocked_out_at,
  sa.attended_on,
  sa.in_source,
  sa.out_source,
  sa.auto_closed,
  sa.notes
from public.staff_attendance sa
join public.staff s on s.id = sa.staff_id
join public.branches b on b.id = sa.branch_id
left join public.devices dv on dv.id = sa.device_id;

-- One staff member over a date window. security invoker: RLS decides whether the
-- caller may see these rows at all, so a manager asking about someone at another
-- branch gets zeros, not data.
create or replace function public.staff_attendance_summary(
  p_staff_id uuid,
  p_from date default null,
  p_to date default null
)
returns table (
  last_clock_in_at timestamptz,
  last_attended_on date,
  on_shift boolean,
  lifetime_days bigint,
  days_in_range bigint,
  minutes_in_range bigint,
  open_shifts_in_range bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    max(sa.clocked_in_at),
    max(sa.attended_on),
    coalesce(bool_or(sa.clocked_out_at is null and not sa.auto_closed), false),
    count(distinct sa.attended_on)::bigint,
    count(distinct sa.attended_on) filter (
      where (p_from is null or sa.attended_on >= p_from)
        and (p_to is null or sa.attended_on <= p_to)
    )::bigint,
    -- Closed shifts only: an open or auto-closed one has no end to measure to.
    coalesce(sum(
      extract(epoch from (sa.clocked_out_at - sa.clocked_in_at)) / 60
    ) filter (
      where sa.clocked_out_at is not null
        and (p_from is null or sa.attended_on >= p_from)
        and (p_to is null or sa.attended_on <= p_to)
    ), 0)::bigint,
    count(*) filter (
      where sa.clocked_out_at is null
        and (p_from is null or sa.attended_on >= p_from)
        and (p_to is null or sa.attended_on <= p_to)
    )::bigint
  from public.staff_attendance sa
  where sa.staff_id = p_staff_id;
$$;

revoke all on public.staff_attendance from public, anon;
grant select on public.staff_attendance to authenticated;
revoke all on public.staff_attendance_detail from public, anon;
grant select on public.staff_attendance_detail to authenticated;

revoke execute on function public.prepare_staff_attendance_row() from public, anon, authenticated;
revoke execute on function public.guard_staff_attendance_immutability() from public, anon, authenticated;
revoke execute on function public.staff_clock_tap(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.staff_attendance_summary(uuid, date, date) from public, anon;
grant execute on function public.staff_attendance_summary(uuid, date, date) to authenticated;
