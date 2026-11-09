-- member_door_check_in: close a check-then-act race in the per-member throttle.
--
-- The 10-bad-codes-in-10-minutes count read door_qr_failures and the failure
-- insert happened later, so N parallel guesses by one member could all read a
-- count below 10 before any of them recorded a failure. Taking a transaction
-- scoped advisory lock keyed on the member BEFORE the count serialises one
-- member's attempts: the next call sees the previous call's failure row once
-- the lock is released at commit. Nothing else about the function changes.

create or replace function public.member_door_check_in(p_payload text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid := public.jwt_member_id();
  v_member public.members%rowtype;
  v_parts text[];
  v_qr_id integer;
  v_code text;
  v_device record;
  v_secret bytea;
  v_window bigint := floor(extract(epoch from now()) / 30);
  v_ok boolean := false;
  v_tz text;
  v_local time;
  v_open boolean;
  v_tap jsonb;
  v_fails integer;
begin
  if v_member_id is null then
    raise exception 'Only a member can scan the door code'
      using errcode = 'insufficient_privilege';
  end if;

  select m.* into v_member from public.members m where m.id = v_member_id;
  if not found then
    raise exception 'Only a member can scan the door code'
      using errcode = 'insufficient_privilege';
  end if;

  -- serialise this member's attempts so parallel guesses cannot all pass the count
  perform pg_advisory_xact_lock(hashtextextended('door_qr:' || v_member.id::text, 0));

  -- throttle: 10 bad codes in 10 minutes
  select count(*) into v_fails
  from public.door_qr_failures f
  where f.member_id = v_member.id and f.failed_at > now() - interval '10 minutes';
  if v_fails >= 10 then
    return jsonb_build_object('result', 'rate_limited', 'reason', 'too_many_bad_codes');
  end if;

  v_parts := regexp_match(coalesce(p_payload, ''), '^LG1\.([0-9]{1,6})\.([0-9]{8})$');
  if v_parts is not null then
    v_qr_id := v_parts[1]::integer;
    v_code := v_parts[2];

    select d.id, d.org_id, d.branch_id, d.name, d.status, b.name as branch_name,
           b.opens_at, b.closes_at
      into v_device
    from public.devices d
    join public.branches b on b.id = d.branch_id
    where d.org_id = v_member.org_id and d.qr_id = v_qr_id;

    if found then
      select s.qr_secret into v_secret
      from public.device_qr_secrets s where s.device_id = v_device.id;
      if v_secret is not null then
        v_ok := v_code in (
          public.door_qr_code(v_secret, v_qr_id, v_window),
          public.door_qr_code(v_secret, v_qr_id, v_window - 1),
          public.door_qr_code(v_secret, v_qr_id, v_window + 1)
        );
      end if;
    end if;
  end if;

  if not v_ok then
    insert into public.door_qr_failures (org_id, member_id)
    values (v_member.org_id, v_member.id);
    delete from public.door_qr_failures f
    where f.member_id = v_member.id and f.failed_at < now() - interval '1 hour';
    return jsonb_build_object('result', 'invalid_code', 'member_name', v_member.full_name);
  end if;

  if v_device.status <> 'active'::public.device_status then
    return jsonb_build_object(
      'result', 'closed', 'reason', 'device_disabled',
      'member_name', v_member.full_name, 'branch_name', v_device.branch_name
    );
  end if;

  -- opening hours in the org's timezone; both null = always open, one null =
  -- unbounded on that side, opens_at > closes_at = overnight.
  select coalesce(o.timezone, 'Asia/Kathmandu') into v_tz
  from public.orgs o where o.id = v_member.org_id;
  v_local := (now() at time zone coalesce(v_tz, 'Asia/Kathmandu'))::time;
  v_open := case
    when v_device.opens_at is null and v_device.closes_at is null then true
    when v_device.opens_at is null then v_local <= v_device.closes_at
    when v_device.closes_at is null then v_local >= v_device.opens_at
    when v_device.opens_at <= v_device.closes_at
      then v_local >= v_device.opens_at and v_local <= v_device.closes_at
    else v_local >= v_device.opens_at or v_local <= v_device.closes_at
  end;
  if not v_open then
    return jsonb_build_object(
      'result', 'closed', 'reason', 'outside_hours',
      'member_name', v_member.full_name, 'branch_name', v_device.branch_name,
      'opens_at', to_char(v_device.opens_at, 'HH24:MI'),
      'closes_at', to_char(v_device.closes_at, 'HH24:MI')
    );
  end if;

  v_tap := public.door_member_tap(v_device.id, v_member.id, 'qr'::public.attendance_method);

  if v_tap ->> 'decision' = 'allow' then
    insert into public.device_unlock_requests (
      org_id, device_id, member_id, attendance_id, display
    )
    values (
      v_member.org_id, v_device.id, v_member.id,
      (v_tap ->> 'attendance_id')::uuid,
      jsonb_build_object(
        'member_name', v_tap -> 'member_name',
        'member_code', v_tap -> 'member_code',
        'days_to_expiry', v_tap -> 'days_to_expiry',
        'status', v_tap -> 'status'
      )
    );
    delete from public.device_unlock_requests r
    where r.device_id = v_device.id and r.created_at < now() - interval '1 day';
  end if;

  return jsonb_build_object(
    'result', case when v_tap ->> 'decision' = 'allow' then 'ok' else 'denied' end,
    'reason', case when v_tap ->> 'decision' = 'allow' then null else v_tap ->> 'reason' end,
    'member_name', v_tap -> 'member_name',
    'days_to_expiry', v_tap -> 'days_to_expiry',
    'due_paisa', v_tap -> 'due_paisa',
    'already_checked_in_today', v_tap -> 'already_checked_in_today',
    'status', v_tap -> 'status',
    'branch_name', v_tap -> 'branch_name'
  );
end;
$$;

-- create or replace keeps the existing grants, restated so the file stands alone
revoke execute on function public.member_door_check_in(text) from public, anon;
grant execute on function public.member_door_check_in(text) to authenticated;
