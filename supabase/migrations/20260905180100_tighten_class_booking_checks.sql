-- Review fixes on the booking RPCs.
--
-- 1. The staff-override path checked jwt_can_serve_members() and the org, but
--    never has_branch_access() -- so a front desk scoped to one branch could
--    book a member into a class at any other branch in the chain. Every other
--    write policy in this schema pairs those two predicates; this one now does
--    too.
-- 2. "Has an active membership" was read as `exists(memberships where status =
--    'active')`, which is looser than the trigger-derived members.status. It
--    admitted a member who had been walked off the books (status 'left') and a
--    session-pack member with zero sessions remaining. The derived status is
--    the canonical answer to "can this person train today", so ask it.
-- 3. The cancellation window cast orgs.settings straight to integer. A
--    non-numeric value raised 22P02 out of every cancellation for that org, and
--    a negative value inverted the cutoff into "cancellable after the class
--    starts". Both now fall back to the documented default.

create or replace function public.class_cancellation_window_minutes(p_org_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(
    case
      when o.settings ->> 'class_cancellation_window_minutes' ~ '^[0-9]+$'
        then (o.settings ->> 'class_cancellation_window_minutes')::integer
    end,
    120
  )
  from public.orgs o
  where o.id = p_org_id;
$$;

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
    -- predicate the member-spine write policies gate on, and has_branch_access()
    -- is the other half of it -- a front desk serves their branches, not the
    -- whole chain.
    if not public.jwt_can_serve_members() then
      raise exception 'Only staff may book a class on behalf of another member'
        using errcode = 'insufficient_privilege';
    end if;
    if not public.is_org_member(v_session.org_id)
       or not public.has_branch_access(v_session.branch_id) then
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

  -- members.status is trigger-derived from the membership rows and already
  -- encodes expiry, freezing, a spent session pack, and having left. Reading
  -- it here keeps this RPC's idea of "may train" identical to the door's.
  if v_member.status <> 'active'::public.member_status then
    raise exception 'Member does not have an active membership'
      using errcode = 'check_violation';
  end if;

  select exists (
    select 1 from public.memberships ms
    where ms.member_id = v_member.id
      and ms.status = 'active'::public.membership_status
      and (
        ms.plan_type = 'time'::public.plan_type
        or coalesce(ms.sessions_remaining, 0) > 0
      )
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

-- booked_count is a live gauge of seats held right now, not a historical
-- attendance count: marking a booking attended or no_show moves it out of
-- 'booked' and the count drops. Utilisation reporting must count bookings, not
-- read this column after the fact.
comment on column public.class_sessions.booked_count is
  'Seats currently held (status = booked). A live capacity gauge, not an attendance total -- it falls as bookings are marked attended or no_show.';
