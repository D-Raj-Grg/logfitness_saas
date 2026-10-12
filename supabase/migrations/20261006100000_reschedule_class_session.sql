-- Reschedule one class session. Bookings stay attached (they hang off
-- session_id, not the time). Owner/manager only, branch-scoped. class_sessions
-- is audited by its own trigger, so the move is recorded with before/after.
create or replace function public.reschedule_class_session(
  p_session_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.class_sessions%rowtype;
begin
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'The session must end after it starts' using errcode = 'check_violation';
  end if;

  select * into v_session from public.class_sessions where id = p_session_id for update;
  if not found or not public.is_org_member(v_session.org_id) then
    raise exception 'Class session not found' using errcode = 'no_data_found';
  end if;

  if not (public.jwt_is_owner() or public.jwt_staff_role() = 'manager'::public.staff_role)
     or not public.has_branch_access(v_session.branch_id) then
    raise exception 'Only an owner or manager of this branch can reschedule a class'
      using errcode = 'insufficient_privilege';
  end if;

  if v_session.status = 'cancelled'::public.class_session_status then
    raise exception 'A cancelled session cannot be rescheduled' using errcode = 'check_violation';
  end if;

  if p_starts_at <= now() then
    raise exception 'A session cannot be moved into the past' using errcode = 'check_violation';
  end if;

  update public.class_sessions
     set starts_at = p_starts_at, ends_at = p_ends_at
   where id = v_session.id;

  return jsonb_build_object('session_id', v_session.id, 'starts_at', p_starts_at, 'ends_at', p_ends_at);
end;
$$;

revoke execute on function public.reschedule_class_session(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.reschedule_class_session(uuid, timestamptz, timestamptz) to authenticated;
