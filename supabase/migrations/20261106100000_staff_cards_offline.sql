-- Staff cards, Phase 3: offline readers.
--
-- Before this, a reader that could not reach the server answered a staff tap as
-- UNKNOWN CARD (staff UIDs were not in its cached list). Now:
--
-- 1. staff_clock_tap takes an optional tap time (p_at), so an offline tap that
--    is uploaded at 6 pm is stamped with the 9 am it happened, not 6 pm.
-- 2. rfid_sync_cards also sends live staff cards, status code 'S', in the same
--    global card_uid order as member cards (paging must stay one ordered scan).
-- 3. rfid_log_offline replays staff taps through staff_clock_tap, oldest first,
--    and never writes them into members' `attendance`.
--
-- Rollout order is migration -> edge function -> firmware 1.3.0. Firmware 1.2.x
-- reads an unknown status letter as "expired" (deny), which is today's behaviour,
-- so nothing changes for a reader until it is flashed.

-- ---------------------------------------------------------------------------
-- 1. staff_clock_tap with a tap time.
--
-- Dropped and recreated rather than overloaded: a 5-arg and a 6-arg version
-- (with a default) would make rfid_check_in's existing 5-arg call ambiguous.
-- plpgsql resolves the call at run time, so the drop does not break it.
drop function public.staff_clock_tap(uuid, uuid, uuid, uuid, text);

create function public.staff_clock_tap(
  p_org_id uuid,
  p_branch_id uuid,
  p_device_id uuid,
  p_staff_id uuid,
  p_source text default 'card',
  p_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := coalesce(p_at, now());
  v_last timestamptz;
  v_open public.staff_attendance%rowtype;
  v_row public.staff_attendance%rowtype;
begin
  -- Two taps racing for the same person queue here instead of both finding "no
  -- open shift" and the unique index throwing at one of them.
  perform pg_advisory_xact_lock(hashtextextended('staff_clock:' || p_staff_id::text, 0));

  -- A replayed (offline) tap must come AFTER everything already recorded for this
  -- person. Otherwise it is either a repeat of a tap we already have (lost reply,
  -- retried upload) or an online tap was recorded after the outage, and slotting
  -- it in would overlap a shift or break clocked_out_at > clocked_in_at.
  if p_at is not null then
    select greatest(max(sa.clocked_in_at), max(sa.clocked_out_at)) into v_last
    from public.staff_attendance sa
    where sa.staff_id = p_staff_id;

    if v_last is not null and v_at <= v_last then
      return jsonb_build_object('clock', 'stale', 'at', v_last);
    end if;
  end if;

  select * into v_open
  from public.staff_attendance sa
  where sa.staff_id = p_staff_id
    and sa.clocked_out_at is null
    and not sa.auto_closed
  for update;

  if found then
    if v_at - v_open.clocked_in_at > interval '16 hours' then
      update public.staff_attendance sa
      set auto_closed = true
      where sa.id = v_open.id;
      -- Falls through to clock in below.
    elsif v_at - v_open.clocked_in_at < interval '2 minutes' then
      return jsonb_build_object(
        'clock', 'already_in',
        'at', v_open.clocked_in_at,
        'attendance_id', v_open.id
      );
    else
      update public.staff_attendance sa
      set clocked_out_at = v_at, out_source = p_source
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
    org_id, staff_id, branch_id, device_id, clocked_in_at, in_source
  )
  values (p_org_id, p_staff_id, p_branch_id, p_device_id, v_at, p_source)
  returning * into v_row;

  return jsonb_build_object(
    'clock', 'in',
    'at', v_row.clocked_in_at,
    'attendance_id', v_row.id
  );
end;
$$;

revoke execute on function public.staff_clock_tap(uuid, uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. rfid_sync_cards: member cards and staff cards in ONE ordered scan.
create or replace function public.rfid_sync_cards(
  p_key_hash text,
  p_after text default null,
  p_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device record;
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 2000);
  v_after text := nullif(public.normalize_card_uid(p_after), '');
  v_today date;
  v_open_ended date := public.rfid_open_ended_date();
  v_cards jsonb := '[]'::jsonb;
  v_last text;
  v_seen integer := 0;
  v_more boolean := false;
  v_row record;
  v_snap record;
  v_banner text;
  v_code text;
  v_until text;
begin
  select d.id, d.org_id, d.branch_id, d.status
    into v_device
  from public.devices d
  where d.key_hash = p_key_hash;

  if not found then
    return jsonb_build_object('decision', 'deny', 'reason', 'device_unknown');
  end if;

  if v_device.status = 'disabled'::public.device_status then
    return jsonb_build_object('decision', 'deny', 'reason', 'device_disabled');
  end if;

  update public.devices d set last_seen_at = now() where d.id = v_device.id;

  v_today := public.org_today(v_device.org_id);

  for v_row in
    select u.card_uid, u.member_id, u.archived, u.is_staff
    from (
      select mc.card_uid, mc.member_id, (m.archived_at is not null) as archived,
             false as is_staff
      from public.member_cards mc
      join public.members m on m.id = mc.member_id
      where mc.org_id = v_device.org_id
        and mc.revoked_at is null
      union all
      -- Only staff who may clock in at THIS door: active, and an owner (works
      -- anywhere) or a branch on their staff row. Anyone else gets no line, so
      -- the reader answers unknown, as the online staff_wrong_branch would deny.
      select sc.card_uid, null::uuid, false, true
      from public.staff_cards sc
      join public.staff s on s.id = sc.staff_id and s.org_id = sc.org_id
      where sc.org_id = v_device.org_id
        and sc.revoked_at is null
        and s.status = 'active'::public.staff_status
        and (s.role = 'owner'::public.staff_role
             or v_device.branch_id = any (s.branch_ids))
    ) u
    where (v_after is null or u.card_uid > v_after)
    order by u.card_uid
    limit v_limit + 1
  loop
    v_seen := v_seen + 1;
    if v_seen > v_limit then
      v_more := true;
      exit;
    end if;
    v_last := v_row.card_uid;

    if v_row.is_staff then
      -- No expiry for staff: the open-ended date, like a membership with no end.
      v_cards := v_cards || jsonb_build_array(jsonb_build_array(
        v_row.card_uid, to_char(v_open_ended, 'YYYYMMDD'), 'S'
      ));
      continue;
    end if;

    v_until := '00000000';

    select * into v_snap from public.attendance_snapshot(v_row.member_id);
    if not found then
      continue;
    end if;
    v_banner := case when v_row.archived then 'left' else v_snap.banner end;

    -- Same order as rfid_check_in: owed money is the reason whatever the banner.
    if coalesce(v_snap.due_paisa, 0) > 0 then
      v_code := 'D';
    elsif v_banner in ('active', 'expiring') then
      v_code := 'A';
      v_until := to_char(
        case
          when v_snap.days_to_expiry is null then v_open_ended
          else v_today + v_snap.days_to_expiry
        end,
        'YYYYMMDD'
      );
    else
      v_code := case v_banner
        when 'expired'  then 'E'
        when 'frozen'   then 'F'
        when 'upcoming' then 'U'
        when 'none'     then 'N'
        when 'left'     then 'L'
        else 'E'
      end;
    end if;

    v_cards := v_cards || jsonb_build_array(jsonb_build_array(v_row.card_uid, v_until, v_code));
  end loop;

  return jsonb_build_object(
    'decision', 'ok',
    'cards', v_cards,
    'more', v_more,
    'last_uid', v_last,
    'org_today', to_char(v_today, 'YYYYMMDD')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. rfid_log_offline: staff taps are clock-ins/outs, replayed in tap order.
create or replace function public.rfid_log_offline(
  p_key_hash text,
  p_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device record;
  v_ev jsonb;
  v_uid text;
  v_ts timestamptz;
  v_member_id uuid;
  v_staff public.staff%rowtype;
  v_tap jsonb;
  v_snap record;
  v_tz text;
  v_today date;
  v_shift integer;
  v_accepted integer := 0;
  v_duplicate integer := 0;
  v_unknown integer := 0;
  v_clamped integer := 0;
  v_bad integer := 0;
  v_staff_clocked integer := 0;
begin
  select d.id, d.org_id, d.branch_id, d.status
    into v_device
  from public.devices d
  where d.key_hash = p_key_hash;

  if not found then
    return jsonb_build_object('decision', 'deny', 'reason', 'device_unknown');
  end if;

  if v_device.status = 'disabled'::public.device_status then
    return jsonb_build_object('decision', 'deny', 'reason', 'device_disabled');
  end if;

  if p_events is null or jsonb_typeof(p_events) <> 'array'
     or jsonb_array_length(p_events) > 100 then
    return jsonb_build_object('decision', 'deny', 'reason', 'bad_batch');
  end if;

  update public.devices d set last_seen_at = now() where d.id = v_device.id;

  select coalesce(o.timezone, 'Asia/Kathmandu') into v_tz
  from public.orgs o where o.id = v_device.org_id;
  v_tz := coalesce(v_tz, 'Asia/Kathmandu');
  v_today := public.org_today(v_device.org_id);

  -- Oldest tap first: a staff in/out pair must replay in the order it happened.
  -- The rfid-sync function always sends ts as a UTC ISO string, which sorts
  -- correctly as text; a tap with no ts sorts last (it is stamped now()).
  for v_ev in
    select e from jsonb_array_elements(p_events) as e
    order by e ->> 'ts' nulls last
  loop
    v_uid := public.normalize_card_uid(v_ev ->> 'uid');
    if v_uid !~ '^[0-9A-F]{8,20}$' then
      v_bad := v_bad + 1;
      continue;
    end if;

    begin
      v_ts := (v_ev ->> 'ts')::timestamptz;
    exception when others then
      v_ts := null;
    end;
    if v_ts is null or v_ts > now() + interval '5 minutes'
       or v_ts < now() - interval '7 days' then
      v_ts := now();
      v_clamped := v_clamped + 1;
    end if;

    -- A UID is live for one holder across staff and members, so at most one of
    -- this and the member lookup below matches.
    select s.* into v_staff
    from public.staff_cards sc
    join public.staff s on s.id = sc.staff_id and s.org_id = sc.org_id
    where sc.org_id = v_device.org_id
      and sc.card_uid = v_uid
      and sc.revoked_at is null;

    if found then
      -- The reader only caches staff who may enter here; re-check, because the
      -- person may have been deactivated or moved since the last sync. Not an
      -- enrollment-inbox case: the card is known.
      if v_staff.status <> 'active'::public.staff_status
         or (v_staff.role <> 'owner'::public.staff_role
             and not (v_device.branch_id = any (v_staff.branch_ids))) then
        v_unknown := v_unknown + 1;
        continue;
      end if;

      v_tap := public.staff_clock_tap(
        v_device.org_id, v_device.branch_id, v_device.id, v_staff.id,
        'offline_card', v_ts
      );
      if v_tap ->> 'clock' in ('in', 'out') then
        v_staff_clocked := v_staff_clocked + 1;
      else
        -- already_in (2-minute double tap) or stale (already recorded).
        v_duplicate := v_duplicate + 1;
      end if;
      continue;
    end if;

    select mc.member_id into v_member_id
    from public.member_cards mc
    where mc.org_id = v_device.org_id
      and mc.card_uid = v_uid
      and mc.revoked_at is null;

    if not found then
      insert into public.unassigned_card_scans (
        org_id, branch_id, device_id, card_uid, first_seen_at, last_seen_at, scan_count
      )
      values (v_device.org_id, v_device.branch_id, v_device.id, v_uid, v_ts, v_ts, 1)
      on conflict (device_id, card_uid) do update
      set last_seen_at = greatest(public.unassigned_card_scans.last_seen_at, excluded.last_seen_at),
          branch_id = excluded.branch_id,
          scan_count = public.unassigned_card_scans.scan_count + 1;
      v_unknown := v_unknown + 1;
      continue;
    end if;

    select * into v_snap from public.attendance_snapshot(v_member_id);

    -- Days between the tap's gym-day and today: how far "days left now" is from
    -- "days left when they tapped".
    v_shift := v_today - (v_ts at time zone v_tz)::date;

    begin
      insert into public.attendance (
        org_id, branch_id, member_id, membership_id, method,
        checked_in_at,
        membership_status_at_checkin, days_to_expiry_at_checkin, due_paisa_at_checkin,
        checked_in_by, device_id
      )
      values (
        v_device.org_id, v_device.branch_id, v_member_id, v_snap.membership_id,
        'card'::public.attendance_method,
        v_ts,
        -- The reader only admits a live membership with nothing owing.
        case when v_snap.membership_id is null then null
             else 'active'::public.membership_status end,
        case when v_snap.days_to_expiry is null then null
             else v_snap.days_to_expiry + v_shift end,
        0,
        null, v_device.id
      );
      v_accepted := v_accepted + 1;
    exception when unique_violation then
      v_duplicate := v_duplicate + 1;
    end;
  end loop;

  return jsonb_build_object(
    'decision', 'ok',
    'accepted', v_accepted,
    'duplicate', v_duplicate,
    'unknown', v_unknown,
    'clamped', v_clamped,
    'bad_uid', v_bad,
    'staff_clocked', v_staff_clocked
  );
end;
$$;

revoke execute on function public.rfid_sync_cards(text, text, integer)
  from public, anon, authenticated;
revoke execute on function public.rfid_log_offline(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.rfid_sync_cards(text, text, integer) to service_role;
grant execute on function public.rfid_log_offline(text, jsonb) to service_role;
