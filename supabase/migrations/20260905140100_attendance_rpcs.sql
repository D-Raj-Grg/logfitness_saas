-- Check-in is one transaction and one round trip: read the member, read what
-- their membership and dues look like right now, write the visit, hand the desk
-- back everything the banner needs. The Flutter app will call the same function
-- for QR entry, so none of this may live in a Server Action.
--
-- Security invoker throughout — RLS is the tenant boundary, and a definer
-- function here would quietly step around it.

-- Turns a membership row plus dues into the single word the front desk screen
-- shouts. Shared by check-in and by the in-gym roster.
create or replace function public.attendance_banner(
  p_member_status public.member_status,
  p_membership_status public.membership_status,
  p_days_to_expiry integer,
  p_sessions_remaining integer
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_member_status = 'left'::public.member_status then 'left'
    when p_membership_status is null then 'none'
    when p_membership_status = 'frozen'::public.membership_status then 'frozen'
    when p_membership_status in (
      'expired'::public.membership_status,
      'cancelled'::public.membership_status
    ) then 'expired'
    when p_membership_status = 'upcoming'::public.membership_status then 'upcoming'
    when p_sessions_remaining is not null and p_sessions_remaining <= 0 then 'expired'
    when p_sessions_remaining is not null and p_sessions_remaining <= 3 then 'expiring'
    when p_days_to_expiry is not null and p_days_to_expiry < 0 then 'expired'
    when p_days_to_expiry is not null and p_days_to_expiry <= 7 then 'expiring'
    else 'active'
  end;
$$;

create or replace function public.check_in_member(
  p_member_id uuid,
  p_branch_id uuid,
  p_method public.attendance_method default 'manual',
  p_override boolean default false,
  p_override_reason text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_member public.members%rowtype;
  v_branch record;
  v_staff_id uuid := public.jwt_staff_id();
  v_membership public.memberships%rowtype;
  v_due_paisa bigint;
  v_days integer;
  v_banner text;
  v_today date;
  v_existing public.attendance%rowtype;
  v_row public.attendance%rowtype;
  v_member_json jsonb;
begin
  select * into v_member from public.members m where m.id = p_member_id;
  if not found then
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;

  select b.id, b.name, b.org_id into v_branch
  from public.branches b
  where b.id = p_branch_id and b.org_id = v_member.org_id;
  if not found then
    raise exception 'Branch not found in this organisation'
      using errcode = 'no_data_found';
  end if;

  if v_staff_id is null then
    raise exception 'Only signed-in staff can check a member in'
      using errcode = 'insufficient_privilege';
  end if;

  v_today := public.org_today(v_member.org_id);

  -- The membership the desk should be looking at: the live one, else the one
  -- that ran out most recently, so an expired member still gets a real date on
  -- screen instead of a blank.
  select * into v_membership
  from public.memberships ms
  where ms.member_id = v_member.id
    and ms.status <> 'cancelled'::public.membership_status
  order by
    (ms.status in (
      'active'::public.membership_status,
      'frozen'::public.membership_status,
      'upcoming'::public.membership_status
    )) desc,
    coalesce(ms.end_date, '9999-12-31'::date) desc,
    ms.start_date desc
  limit 1;

  select coalesce(sum(i.due_paisa), 0) into v_due_paisa
  from public.invoices i
  where i.member_id = v_member.id
    and i.status in ('unpaid'::public.invoice_status, 'partial'::public.invoice_status)
    and i.due_paisa > 0;

  v_days := case
    when v_membership.end_date is null then null
    else v_membership.end_date - v_today
  end;

  v_banner := public.attendance_banner(
    v_member.status,
    v_membership.status,
    v_days,
    v_membership.sessions_remaining
  );

  v_member_json := jsonb_build_object(
    'id', v_member.id,
    'member_code', v_member.member_code,
    'full_name', v_member.full_name,
    'phone', v_member.phone,
    'photo_path', v_member.photo_path,
    'status', v_member.status,
    'home_branch_id', v_member.home_branch_id
  );

  -- Already here today? Not an error — the desk sees the first visit and
  -- decides whether this one is real. Only an explicit override writes a
  -- second row.
  select * into v_existing
  from public.attendance a
  where a.member_id = v_member.id
    and a.attended_on = v_today
  order by a.checked_in_at desc
  limit 1;

  if found and not coalesce(p_override, false) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'already_checked_in',
      'banner', v_banner,
      'member', v_member_json,
      'branch', jsonb_build_object('id', v_branch.id, 'name', v_branch.name),
      'due_paisa', v_due_paisa,
      'membership', case
        when v_membership.id is null then null
        else jsonb_build_object(
          'id', v_membership.id,
          'plan_name', v_membership.plan_name,
          'plan_type', v_membership.plan_type,
          'status', v_membership.status,
          'end_date', v_membership.end_date,
          'days_to_expiry', v_days,
          'sessions_remaining', v_membership.sessions_remaining
        )
      end,
      'existing', jsonb_build_object(
        'id', v_existing.id,
        'checked_in_at', v_existing.checked_in_at,
        'checked_out_at', v_existing.checked_out_at,
        'branch_id', v_existing.branch_id
      )
    );
  end if;

  if coalesce(p_override, false)
     and v_existing.id is not null
     and length(btrim(coalesce(p_override_reason, ''))) = 0 then
    raise exception 'An override needs a reason'
      using errcode = 'check_violation';
  end if;

  insert into public.attendance (
    org_id, branch_id, member_id, membership_id, method,
    checked_in_at, attended_on,
    membership_status_at_checkin, days_to_expiry_at_checkin, due_paisa_at_checkin,
    is_override, override_reason, checked_in_by, notes
  )
  values (
    v_member.org_id, p_branch_id, v_member.id, v_membership.id,
    coalesce(p_method, 'manual'::public.attendance_method),
    now(), v_today,
    v_membership.status, v_days, v_due_paisa,
    coalesce(p_override, false) and v_existing.id is not null,
    p_override_reason, v_staff_id, p_notes
  )
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'reason', null,
    'banner', v_banner,
    'member', v_member_json,
    'branch', jsonb_build_object('id', v_branch.id, 'name', v_branch.name),
    'due_paisa', v_due_paisa,
    'membership', case
      when v_membership.id is null then null
      else jsonb_build_object(
        'id', v_membership.id,
        'plan_name', v_membership.plan_name,
        'plan_type', v_membership.plan_type,
        'status', v_membership.status,
        'end_date', v_membership.end_date,
        'days_to_expiry', v_days,
        'sessions_remaining', v_membership.sessions_remaining
      )
    end,
    'attendance', jsonb_build_object(
      'id', v_row.id,
      'checked_in_at', v_row.checked_in_at,
      'attended_on', v_row.attended_on,
      'method', v_row.method,
      'is_override', v_row.is_override
    )
  );
end;
$$;

create or replace function public.check_out_member(p_attendance_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.attendance%rowtype;
begin
  select * into v_row from public.attendance a where a.id = p_attendance_id;
  if not found then
    raise exception 'Check-in not found' using errcode = 'no_data_found';
  end if;

  if v_row.checked_out_at is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'already_checked_out',
      'attendance_id', v_row.id,
      'checked_out_at', v_row.checked_out_at
    );
  end if;

  update public.attendance a
  set checked_out_at = now()
  where a.id = p_attendance_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'reason', null,
    'attendance_id', v_row.id,
    'checked_in_at', v_row.checked_in_at,
    'checked_out_at', v_row.checked_out_at
  );
end;
$$;

-- Supabase hands EXECUTE on every new public function to anon and authenticated
-- by default. Take it back, then give it out deliberately.
revoke execute on function public.attendance_banner(
  public.member_status, public.membership_status, integer, integer
) from public, anon;
revoke execute on function public.check_in_member(
  uuid, uuid, public.attendance_method, boolean, text, text
) from public, anon;
revoke execute on function public.check_out_member(uuid) from public, anon;

grant execute on function public.attendance_banner(
  public.member_status, public.membership_status, integer, integer
) to authenticated;
grant execute on function public.check_in_member(
  uuid, uuid, public.attendance_method, boolean, text, text
) to authenticated;
grant execute on function public.check_out_member(uuid) to authenticated;
