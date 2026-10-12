-- Phase 4 -- attendance marking, the 60-day session materializer, trainer
-- utilization.

-- A seat that was attended or no-showed was still a held seat; counting only
-- 'booked' made capacity drop as the trainer marked the room.
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
         and b.status in ('booked'::public.class_booking_status,
                          'attended'::public.class_booking_status,
                          'no_show'::public.class_booking_status)
     )
   where id = v_session_id;

  if tg_op = 'UPDATE' and old.session_id is distinct from new.session_id then
    update public.class_sessions
       set booked_count = (
         select count(*) from public.class_bookings b
         where b.session_id = old.session_id
           and b.status in ('booked'::public.class_booking_status,
                            'attended'::public.class_booking_status,
                            'no_show'::public.class_booking_status)
       )
     where id = old.session_id;
  end if;

  return coalesce(new, old);
end;
$$;

revoke execute on function public.maintain_class_session_booked_count()
  from public, anon, authenticated;

-- mark_session_attendance ---------------------------------------------------------
create or replace function public.mark_session_attendance(p_booking_id uuid, p_attended boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.class_bookings%rowtype;
  v_s public.class_sessions%rowtype;
  v_new public.class_booking_status;
begin
  if p_attended is null then
    raise exception 'Say whether the member attended' using errcode = 'check_violation';
  end if;

  select * into v_b from public.class_bookings where id = p_booking_id for update;
  if not found or not public.is_org_member(v_b.org_id) then
    raise exception 'Booking not found' using errcode = 'no_data_found';
  end if;

  select * into v_s from public.class_sessions where id = v_b.session_id for update;

  if not (
    (public.jwt_staff_role() = 'trainer'::public.staff_role
       and v_s.trainer_id is not null and v_s.trainer_id = public.jwt_staff_id()
       and public.has_branch_access(v_s.branch_id))
    or ((public.jwt_is_owner() or public.jwt_staff_role() = 'manager'::public.staff_role)
       and public.has_branch_access(v_s.branch_id))
  ) then
    raise exception 'Only the trainer of this session, a manager or an owner can mark attendance'
      using errcode = 'insufficient_privilege';
  end if;

  if v_s.status = 'cancelled'::public.class_session_status then
    raise exception 'This session was cancelled' using errcode = 'check_violation';
  end if;

  if v_s.starts_at > now() then
    raise exception 'Attendance can be marked once the session has started'
      using errcode = 'check_violation';
  end if;

  if v_b.status not in ('booked'::public.class_booking_status,
                        'attended'::public.class_booking_status,
                        'no_show'::public.class_booking_status) then
    raise exception 'Only a booked seat can be marked (this one is %)', v_b.status
      using errcode = 'check_violation';
  end if;

  v_new := case when p_attended then 'attended'::public.class_booking_status
                else 'no_show'::public.class_booking_status end;

  update public.class_bookings set status = v_new where id = v_b.id;

  return jsonb_build_object('booking_id', v_b.id, 'status', v_new);
end;
$$;

revoke execute on function public.mark_session_attendance(uuid, boolean) from public, anon;
grant execute on function public.mark_session_attendance(uuid, boolean) to authenticated;

-- Materializer --------------------------------------------------------------------
-- original_starts_at is the recurrence slot a session was generated for. It
-- survives a reschedule, so a moved session is not generated a second time at
-- its old slot.
alter table public.class_sessions add column original_starts_at timestamptz;
create unique index class_sessions_one_per_slot
  on public.class_sessions (class_id, original_starts_at)
  where original_starts_at is not null;

create or replace function public.materialize_class_sessions(
  p_class_id uuid default null,
  p_days integer default 60
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.class_sessions (
    org_id, branch_id, class_id, starts_at, ends_at, capacity, trainer_id, original_starts_at
  )
  select c.org_id, c.branch_id, c.id, s.starts, s.ends, c.capacity, c.trainer_id, s.starts
  from public.classes c
  join public.orgs o on o.id = c.org_id
  cross join lateral jsonb_array_elements(c.recurrence) as r(value)
  cross join lateral (
    select g::date as day
    from generate_series(
      timezone(o.timezone, now())::date::timestamp,
      (timezone(o.timezone, now())::date + p_days)::timestamp,
      interval '1 day'
    ) g
  ) d
  cross join lateral (
    select ((d.day + (r.value ->> 'start_time')::time) at time zone o.timezone) as starts,
           ((d.day + (r.value ->> 'end_time')::time) at time zone o.timezone) as ends
  ) s
  where c.is_active
    and (p_class_id is null or c.id = p_class_id)
    and extract(dow from d.day)::int = (r.value ->> 'day_of_week')::int
    and s.starts > now()
    and not exists (
      select 1 from public.class_sessions x
      where x.class_id = c.id
        and (x.original_starts_at = s.starts or x.starts_at = s.starts)
    )
  on conflict do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.materialize_class_sessions(uuid, integer) from public, anon, authenticated;

-- Lets the Class CRUD UI fill the calendar right after a class is saved,
-- instead of waiting for the nightly job.
create or replace function public.generate_class_sessions(p_class_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_class public.classes%rowtype;
begin
  select * into v_class from public.classes where id = p_class_id;
  if not found or not public.is_org_member(v_class.org_id) then
    raise exception 'Class not found' using errcode = 'no_data_found';
  end if;
  if not (public.jwt_is_owner() or public.jwt_staff_role() = 'manager'::public.staff_role)
     or not public.has_branch_access(v_class.branch_id) then
    raise exception 'Only an owner or manager of this branch can generate sessions'
      using errcode = 'insufficient_privilege';
  end if;
  return public.materialize_class_sessions(p_class_id, 60);
end;
$$;

revoke execute on function public.generate_class_sessions(uuid) from public, anon;
grant execute on function public.generate_class_sessions(uuid) to authenticated;

-- 20:30 UTC = 02:15 in Kathmandu; runs after the expiry sweep.
select cron.unschedule(jobid) from cron.job where jobname = 'materialize-class-sessions';
select cron.schedule('materialize-class-sessions', '30 20 * * *',
  $cron$select public.materialize_class_sessions()$cron$);

-- trainer_utilization -------------------------------------------------------------
-- Security invoker: RLS decides which rows the caller sees; p_branch_ids narrows.
create or replace function public.trainer_utilization(
  p_branch_ids uuid[] default null,
  p_from date default null,
  p_to date default null
)
returns table (
  trainer_id uuid,
  trainer_name text,
  branch_id uuid,
  branch_name text,
  classes_held bigint,
  class_hours numeric,
  seats_available bigint,
  seats_filled bigint,
  fill_pct numeric,
  attended bigint,
  no_shows bigint,
  pt_scheduled bigint,
  pt_completed bigint,
  pt_hours numeric
)
language sql
stable
set search_path = ''
as $$
  with cls as (
    select cs.trainer_id, cs.branch_id,
           count(*) as classes_held,
           sum(extract(epoch from (cs.ends_at - cs.starts_at)) / 3600.0) as class_hours,
           sum(cs.capacity) as seats_available,
           sum(bk.filled) as seats_filled,
           sum(bk.attended) as attended,
           sum(bk.no_shows) as no_shows
    from public.class_sessions cs
    join public.orgs o on o.id = cs.org_id
    cross join lateral (
      select count(*) filter (where b.status in ('booked', 'attended', 'no_show')) as filled,
             count(*) filter (where b.status = 'attended') as attended,
             count(*) filter (where b.status = 'no_show') as no_shows
      from public.class_bookings b where b.session_id = cs.id
    ) bk
    where cs.trainer_id is not null
      and cs.status = 'scheduled'
      and (p_branch_ids is null or cs.branch_id = any (p_branch_ids))
      and (cs.starts_at at time zone o.timezone)::date
          >= coalesce(p_from, public.org_today(cs.org_id) - 30)
      and (cs.starts_at at time zone o.timezone)::date
          <= coalesce(p_to, public.org_today(cs.org_id))
    group by 1, 2
  ),
  pt as (
    select ps.trainer_id, ps.branch_id,
           count(*) filter (where ps.status = 'scheduled') as pt_scheduled,
           count(*) filter (where ps.status = 'completed') as pt_completed,
           sum(ps.duration_minutes / 60.0) filter (where ps.status = 'completed') as pt_hours
    from public.pt_sessions ps
    join public.orgs o on o.id = ps.org_id
    where ps.status <> 'cancelled'
      and (p_branch_ids is null or ps.branch_id = any (p_branch_ids))
      and (ps.scheduled_at at time zone o.timezone)::date
          >= coalesce(p_from, public.org_today(ps.org_id) - 30)
      and (ps.scheduled_at at time zone o.timezone)::date
          <= coalesce(p_to, public.org_today(ps.org_id))
    group by 1, 2
  )
  select
    coalesce(c.trainer_id, p.trainer_id),
    st.full_name,
    coalesce(c.branch_id, p.branch_id),
    br.name,
    coalesce(c.classes_held, 0)::bigint,
    round(coalesce(c.class_hours, 0), 2),
    coalesce(c.seats_available, 0)::bigint,
    coalesce(c.seats_filled, 0)::bigint,
    case when coalesce(c.seats_available, 0) = 0 then 0
         else round(100.0 * c.seats_filled / c.seats_available, 1) end,
    coalesce(c.attended, 0)::bigint,
    coalesce(c.no_shows, 0)::bigint,
    coalesce(p.pt_scheduled, 0)::bigint,
    coalesce(p.pt_completed, 0)::bigint,
    round(coalesce(p.pt_hours, 0), 2)
  from cls c
  full join pt p on p.trainer_id = c.trainer_id and p.branch_id = c.branch_id
  join public.staff st on st.id = coalesce(c.trainer_id, p.trainer_id)
  join public.branches br on br.id = coalesce(c.branch_id, p.branch_id)
  order by st.full_name, br.name;
$$;

revoke execute on function public.trainer_utilization(uuid[], date, date) from public, anon;
grant execute on function public.trainer_utilization(uuid[], date, date) to authenticated;
