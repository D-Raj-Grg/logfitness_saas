-- Class booking RPCs. Unlike the member-spine RPCs (renew_membership and
-- friends), these run SECURITY DEFINER on purpose: members hold no insert or
-- update policy on class_bookings at all -- deliberately, per the schema
-- migration -- so a security-invoker function would have nothing to write
-- through. Every check RLS would normally make is therefore made by hand,
-- inside the function, before any write happens.

-- Per-org cancellation window, read from orgs.settings so a chain can tune it
-- without a migration. Key: settings->>'class_cancellation_window_minutes'.
-- Documented default: 120 minutes (2 hours) before the session starts.
create or replace function public.class_cancellation_window_minutes(p_org_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(o.settings ->> 'class_cancellation_window_minutes', '')::integer,
    120
  )
  from public.orgs o
  where o.id = p_org_id;
$$;

revoke execute on function public.class_cancellation_window_minutes(uuid) from public, anon;
grant execute on function public.class_cancellation_window_minutes(uuid) to authenticated;


create or replace function public.book_class_session(
  p_session_id uuid,
  p_member_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
  v_member public.members%rowtype;
  v_calling_member_id uuid;
  v_target_member_id uuid;
  v_has_active_membership boolean;
  v_status public.class_booking_status;
  v_booking public.class_bookings%rowtype;
begin
  -- Lock the session row for the whole decision: two members racing for the
  -- last seat must be serialized, not both told "booked".
  select * into v_session from public.class_sessions where id = p_session_id for update;
  if not found then
    raise exception 'Class session not found' using errcode = 'no_data_found';
  end if;

  if v_session.status = 'cancelled'::public.class_session_status then
    raise exception 'This class session has been cancelled'
      using errcode = 'check_violation';
  end if;

  if v_session.starts_at <= now() then
    raise exception 'This class session has already started'
      using errcode = 'check_violation';
  end if;

  if p_member_id is not null then
    -- Staff booking on behalf of a member. jwt_can_serve_members() is the same
    -- predicate the member-spine write policies gate on.
    if not public.jwt_can_serve_members() then
      raise exception 'Only staff may book a class on behalf of another member'
        using errcode = 'insufficient_privilege';
    end if;
    if not public.is_org_member(v_session.org_id) then
      raise exception 'Class session not found' using errcode = 'no_data_found';
    end if;
    v_target_member_id := p_member_id;
  else
    -- Self-service booking. jwt_member_id() is the normal path; the auth.uid()
    -- lookup only matters for the brief window before a member's claims are
    -- refreshed after being linked.
    v_calling_member_id := public.jwt_member_id();
    if v_calling_member_id is null then
      select id into v_calling_member_id
      from public.members
      where auth_user_id = auth.uid() and status <> 'left'::public.member_status;
    end if;

    if v_calling_member_id is null then
      raise exception 'Not signed in as a member' using errcode = 'insufficient_privilege';
    end if;

    v_target_member_id := v_calling_member_id;
  end if;

  select * into v_member from public.members where id = v_target_member_id;
  if not found or v_member.org_id <> v_session.org_id then
    -- Either the member does not exist, belongs to another org, or RLS would
    -- hide it. Indistinguishable by design, same as invite_member().
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;

  if v_member.home_branch_id <> v_session.branch_id then
    raise exception 'This class is not offered at the member''s branch'
      using errcode = 'check_violation';
  end if;

  select exists (
    select 1 from public.memberships ms
    where ms.member_id = v_member.id
      and ms.status = 'active'::public.membership_status
  ) into v_has_active_membership;

  if not v_has_active_membership then
    raise exception 'Member does not have an active membership'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.class_bookings b
    where b.session_id = v_session.id
      and b.member_id = v_member.id
      and b.status in ('booked'::public.class_booking_status, 'waitlisted'::public.class_booking_status)
  ) then
    raise exception 'This member already holds a booking on this session'
      using errcode = 'unique_violation';
  end if;

  v_status := case
    when v_session.booked_count < v_session.capacity then 'booked'::public.class_booking_status
    else 'waitlisted'::public.class_booking_status
  end;

  insert into public.class_bookings (org_id, branch_id, session_id, member_id, status)
  values (v_session.org_id, v_session.branch_id, v_session.id, v_member.id, v_status)
  returning * into v_booking;

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'status', v_booking.status,
    'session_id', v_session.id,
    'member_id', v_member.id,
    'booked_at', v_booking.booked_at
  );
end;
$$;

revoke execute on function public.book_class_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.book_class_session(uuid, uuid) to authenticated;


create or replace function public.cancel_class_booking(
  p_booking_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.class_bookings%rowtype;
  v_session public.class_sessions%rowtype;
  v_calling_member_id uuid;
  v_is_staff_cancel boolean := false;
  v_window_minutes integer;
  v_cutoff timestamptz;
  v_was_booked boolean;
  v_promoted_id uuid;
begin
  select * into v_booking from public.class_bookings where id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found' using errcode = 'no_data_found';
  end if;

  if v_booking.status = 'cancelled'::public.class_booking_status then
    raise exception 'This booking is already cancelled' using errcode = 'check_violation';
  end if;

  select * into v_session from public.class_sessions where id = v_booking.session_id for update;
  if not found then
    raise exception 'Class session not found' using errcode = 'no_data_found';
  end if;

  v_calling_member_id := public.jwt_member_id();

  if v_calling_member_id is not null then
    if v_booking.member_id <> v_calling_member_id then
      -- Not this member's booking, and RLS would hide it either way.
      raise exception 'Booking not found' using errcode = 'no_data_found';
    end if;

    v_window_minutes := public.class_cancellation_window_minutes(v_booking.org_id);
    v_cutoff := v_session.starts_at - make_interval(mins => v_window_minutes);

    if now() > v_cutoff then
      raise exception
        'Bookings can only be cancelled at least % minutes before the class starts',
        v_window_minutes
        using errcode = 'check_violation';
    end if;
  elsif public.jwt_can_serve_members() and public.is_org_member(v_booking.org_id) then
    -- Staff cancel any booking in their org, at any time -- including after
    -- the session has started, for correcting a desk mistake after the fact.
    v_is_staff_cancel := true;
  else
    raise exception 'Booking not found' using errcode = 'no_data_found';
  end if;

  -- Only a live 'booked' row ever held a seat worth freeing. Cancelling a
  -- waitlisted booking promotes nobody.
  v_was_booked := v_booking.status = 'booked'::public.class_booking_status;

  update public.class_bookings
     set status = 'cancelled'::public.class_booking_status,
         cancelled_at = now(),
         cancel_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = v_booking.id
  returning * into v_booking;

  if v_was_booked then
    -- The oldest waitlisted booking on this session takes the freed seat, in
    -- the same transaction so the seat is never briefly unclaimed.
    update public.class_bookings
       set status = 'booked'::public.class_booking_status
     where id = (
       select id from public.class_bookings
       where session_id = v_booking.session_id
         and status = 'waitlisted'::public.class_booking_status
       order by booked_at
       limit 1
       for update skip locked
     )
    returning id into v_promoted_id;
  end if;

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'status', v_booking.status,
    'cancelled_at', v_booking.cancelled_at,
    'cancelled_by_staff', v_is_staff_cancel,
    'promoted_booking_id', v_promoted_id
  );
end;
$$;

revoke execute on function public.cancel_class_booking(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_class_booking(uuid, text) to authenticated;
