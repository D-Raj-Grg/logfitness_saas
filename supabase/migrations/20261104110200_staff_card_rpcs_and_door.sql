-- Staff cards, part 3 -- assigning them, and the door recognising them.
--
-- assign_staff_card / revoke_staff_card are security invoker like the member
-- ones: the staff_cards RLS policies are the boundary, and these give the
-- readable errors in front of it.
--
-- rfid_check_in is redefined from the live definition with ONE addition, step
-- 2b: a live staff card is answered as a clock-in/out and returns before the
-- member path. Everything after it -- unknown-card inbox, snapshot, dues rule,
-- once-per-day -- is unchanged, so a member tap behaves exactly as before.

create or replace function public.assign_staff_card(
  p_staff_id uuid,
  p_card_uid text,
  p_replace boolean default false
)
returns public.staff_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid text := public.normalize_card_uid(p_card_uid);
  v_actor uuid := public.jwt_staff_id();
  v_target public.staff%rowtype;
  v_live public.staff_cards%rowtype;
  v_row public.staff_cards%rowtype;
begin
  if v_actor is null
     or public.jwt_staff_role() not in ('owner'::public.staff_role, 'manager'::public.staff_role) then
    raise exception 'Only owners and managers can assign staff cards'
      using errcode = 'insufficient_privilege';
  end if;

  if v_uid !~ '^[0-9A-F]{8,20}$' then
    raise exception 'A card UID is 8 to 20 hex characters'
      using errcode = 'check_violation';
  end if;

  select * into v_target from public.staff s where s.id = p_staff_id;
  if not found then
    raise exception 'Staff member not found' using errcode = 'no_data_found';
  end if;

  -- Same ceiling as reassigning a role: a manager staffs their own floor.
  if not public.jwt_is_owner() then
    if v_target.role not in ('front_desk'::public.staff_role, 'trainer'::public.staff_role)
       or not (v_target.branch_ids && public.jwt_branch_ids()) then
      raise exception 'You cannot give that person a card'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if v_target.status <> 'active'::public.staff_status then
    raise exception 'Activate this person before giving them a card'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.member_cards mc
    where mc.org_id = v_target.org_id and mc.card_uid = v_uid and mc.revoked_at is null
  ) then
    raise exception 'That card is already assigned to a member'
      using errcode = 'unique_violation';
  end if;

  if exists (
    select 1 from public.staff_cards sc
    where sc.org_id = v_target.org_id
      and sc.card_uid = v_uid
      and sc.revoked_at is null
      and sc.staff_id <> v_target.id
  ) then
    raise exception 'That card is already assigned to another staff member'
      using errcode = 'unique_violation';
  end if;

  select * into v_live
  from public.staff_cards sc
  where sc.staff_id = v_target.id and sc.revoked_at is null;

  if found and v_live.card_uid = v_uid then
    v_row := v_live;
  else
    if found then
      if not coalesce(p_replace, false) then
        raise exception 'This person already has a card; replace it instead'
          using errcode = 'unique_violation';
      end if;

      update public.staff_cards sc
      set revoked_at = now(),
          revoked_by = v_actor,
          revoke_reason = 'Replaced'
      where sc.id = v_live.id;
    end if;

    insert into public.staff_cards (org_id, staff_id, card_uid, assigned_by)
    values (v_target.org_id, v_target.id, v_uid, v_actor)
    returning * into v_row;
  end if;

  -- No longer a stranger at any reader in the org.
  perform public.clear_unassigned_card_scans(v_uid);

  return v_row;
end;
$$;

create or replace function public.revoke_staff_card(
  p_staff_id uuid,
  p_reason text
)
returns public.staff_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := public.jwt_staff_id();
  v_row public.staff_cards%rowtype;
begin
  if v_actor is null
     or public.jwt_staff_role() not in ('owner'::public.staff_role, 'manager'::public.staff_role) then
    raise exception 'Only owners and managers can revoke staff cards'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Revoking a card needs a reason'
      using errcode = 'check_violation';
  end if;

  update public.staff_cards sc
  set revoked_at = now(),
      revoked_by = v_actor,
      revoke_reason = btrim(p_reason)
  where sc.staff_id = p_staff_id and sc.revoked_at is null
  returning * into v_row;

  -- RLS filters a row the caller may not touch to "not found", so this is also
  -- the answer for a manager aiming at an owner or another branch.
  if not found then
    raise exception 'This person has no active card you can revoke'
      using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$$;

create or replace function public.rfid_check_in(
  p_key_hash text,
  p_card_uid text,
  p_scanned_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device record;
  v_uid text;
  v_member public.members%rowtype;
  v_snap record;
  v_banner text;
  v_allowed boolean;
  v_reason text;
  v_today date;
  v_existing_id uuid;
  v_attendance_id uuid;
  v_staff public.staff%rowtype;
  v_tap jsonb;
  v_clock text;
begin
  -- 1. Which reader is this?
  select d.id, d.org_id, d.branch_id, d.name, d.status, b.name as branch_name
    into v_device
  from public.devices d
  join public.branches b on b.id = d.branch_id
  where d.key_hash = p_key_hash;

  if not found then
    return jsonb_build_object('decision', 'deny', 'reason', 'device_unknown');
  end if;

  if v_device.status = 'disabled'::public.device_status then
    return jsonb_build_object(
      'decision', 'deny', 'reason', 'device_disabled',
      'device_name', v_device.name, 'branch_name', v_device.branch_name
    );
  end if;

  update public.devices d set last_seen_at = now() where d.id = v_device.id;

  -- 2. A UID the reader could not read cleanly.
  v_uid := public.normalize_card_uid(p_card_uid);
  if v_uid !~ '^[0-9A-F]{8,20}$' then
    return jsonb_build_object(
      'decision', 'deny', 'reason', 'bad_uid',
      'device_name', v_device.name, 'branch_name', v_device.branch_name
    );
  end if;

  -- 2b. A staff card? A UID is live for one holder across members and staff
  -- (assert_card_uid_free), so at most one of this and step 3 can match. A staff
  -- tap is the person's own clock-in/out and never touches member attendance.
  select s.* into v_staff
  from public.staff_cards sc
  join public.staff s on s.id = sc.staff_id and s.org_id = sc.org_id
  where sc.org_id = v_device.org_id
    and sc.card_uid = v_uid
    and sc.revoked_at is null;

  if found then
    -- Only someone who works here, today, at this door. Owners work anywhere;
    -- everyone else at the branches on their staff row.
    if v_staff.status <> 'active'::public.staff_status then
      return jsonb_build_object(
        'decision', 'deny', 'reason', 'staff_inactive',
        'member_name', v_staff.full_name, 'member_code', 'STAFF',
        'status', 'staff',
        'branch_name', v_device.branch_name, 'device_name', v_device.name
      );
    end if;

    if v_staff.role <> 'owner'::public.staff_role
       and not (v_device.branch_id = any (v_staff.branch_ids)) then
      return jsonb_build_object(
        'decision', 'deny', 'reason', 'staff_wrong_branch',
        'member_name', v_staff.full_name, 'member_code', 'STAFF',
        'status', 'staff',
        'branch_name', v_device.branch_name, 'device_name', v_device.name
      );
    end if;

    v_tap := public.staff_clock_tap(
      v_device.org_id, v_device.branch_id, v_device.id, v_staff.id, 'card'
    );
    v_clock := v_tap ->> 'clock';

    -- The reader already draws ALLOW + name for any allow, and ALREADY IN when
    -- already_checked_in_today is set, so a double-tap reads correctly without
    -- new firmware. kind / clock / at are for the firmware that will say
    -- CLOCKED IN / OUT.
    return jsonb_build_object(
      'decision', 'allow',
      'reason', case v_clock
        when 'in' then 'staff_in'
        when 'out' then 'staff_out'
        else 'staff_already_in'
      end,
      'member_name', v_staff.full_name,
      'member_code', 'STAFF',
      'status', 'staff',
      'days_to_expiry', null,
      'due_paisa', 0,
      'already_checked_in_today', v_clock = 'already_in',
      'attendance_id', v_tap ->> 'attendance_id',
      'kind', 'staff',
      'clock', v_clock,
      'at', v_tap ->> 'at',
      'branch_name', v_device.branch_name,
      'device_name', v_device.name
    );
  end if;

  -- 3. Whose card? A stranger goes to the enrollment inbox.
  select m.* into v_member
  from public.member_cards mc
  join public.members m on m.id = mc.member_id
  where mc.org_id = v_device.org_id
    and mc.card_uid = v_uid
    and mc.revoked_at is null;

  if not found then
    insert into public.unassigned_card_scans (
      org_id, branch_id, device_id, card_uid, first_seen_at, last_seen_at, scan_count
    )
    values (
      v_device.org_id, v_device.branch_id, v_device.id, v_uid, now(), now(), 1
    )
    on conflict (device_id, card_uid) do update
    set last_seen_at = now(),
        branch_id = excluded.branch_id,
        scan_count = public.unassigned_card_scans.scan_count + 1;

    delete from public.unassigned_card_scans s
    where s.device_id = v_device.id
      and s.last_seen_at < now() - interval '7 days';

    return jsonb_build_object(
      'decision', 'deny', 'reason', 'unknown_card',
      'device_name', v_device.name, 'branch_name', v_device.branch_name
    );
  end if;

  -- 4. What would the desk see? An archived member is gone, whatever their
  -- last membership says.
  select * into v_snap from public.attendance_snapshot(v_member.id);
  v_banner := case when v_member.archived_at is not null then 'left' else v_snap.banner end;

  -- 5. Allow only a current membership with nothing owing.
  v_allowed := v_banner in ('active', 'expiring') and coalesce(v_snap.due_paisa, 0) = 0;
  v_reason := case when coalesce(v_snap.due_paisa, 0) > 0 then 'dues' else v_banner end;

  -- 6. Already in today? A second tap is a no-op, not a second visit.
  v_today := public.org_today(v_device.org_id);

  select a.id into v_existing_id
  from public.attendance a
  where a.member_id = v_member.id and a.attended_on = v_today
  order by a.checked_in_at desc
  limit 1;

  -- 7. Write the visit. Denied taps write nothing.
  if v_allowed and v_existing_id is null then
    begin
      insert into public.attendance (
        org_id, branch_id, member_id, membership_id, method,
        checked_in_at, attended_on,
        membership_status_at_checkin, days_to_expiry_at_checkin, due_paisa_at_checkin,
        checked_in_by, device_id
      )
      values (
        v_device.org_id, v_device.branch_id, v_member.id, v_snap.membership_id,
        'card'::public.attendance_method,
        now(), v_today,
        v_snap.membership_status, v_snap.days_to_expiry, coalesce(v_snap.due_paisa, 0),
        null, v_device.id
      )
      returning id into v_attendance_id;
    exception when unique_violation then
      -- Two taps raced; the other one won.
      select a.id into v_existing_id
      from public.attendance a
      where a.member_id = v_member.id and a.attended_on = v_today
      order by a.checked_in_at desc
      limit 1;
    end;
  end if;

  -- 8. The reader's answer.
  return jsonb_build_object(
    'decision', case when v_allowed then 'allow' else 'deny' end,
    'reason', v_reason,
    'member_name', v_member.full_name,
    'member_code', v_member.member_code,
    'status', v_banner,
    'days_to_expiry', v_snap.days_to_expiry,
    'due_paisa', coalesce(v_snap.due_paisa, 0),
    'already_checked_in_today', v_existing_id is not null,
    'attendance_id', coalesce(v_attendance_id, v_existing_id),
    'branch_name', v_device.branch_name,
    'device_name', v_device.name
  );
end;
$$;

-- Grant hygiene, restated. rfid_check_in stays service-role only: a signed-in
-- user calling it directly would be a device impersonator.
revoke execute on function public.assign_staff_card(uuid, text, boolean) from public, anon;
revoke execute on function public.revoke_staff_card(uuid, text) from public, anon;
revoke execute on function public.rfid_check_in(text, text, timestamptz) from public, anon, authenticated;

grant execute on function public.assign_staff_card(uuid, text, boolean) to authenticated;
grant execute on function public.revoke_staff_card(uuid, text) to authenticated;
grant execute on function public.rfid_check_in(text, text, timestamptz) to service_role;
