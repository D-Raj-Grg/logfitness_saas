-- Code-review fixes for RFID offline mode.
--
-- 1. rfid_sync_cards: an archived member who still owes money is 'D', not 'L',
--    matching rfid_check_in (which reports 'dues' whenever due_paisa > 0, even
--    for someone who has left). Online and offline now show the same message.
--
-- 2. rfid_log_offline: a backfilled visit no longer stores a snapshot taken at
--    UPLOAD time as if it were the state at check-in. attendance rows are
--    evidence ("never recomputed"), so the snapshot records what the reader
--    decided on: it only admits a live membership with nothing owing, so due is
--    0 and the status is 'active'; days_to_expiry is the days left AT THE TAP
--    (days left now plus the days between the tap and today). A membership that
--    was renewed or changed between the tap and the upload is still read as it
--    is now; that is the best the server can know, and is documented here.
--
-- 3. The "unknown card" branch of rfid_log_offline is defensive only: the
--    reader never queues a denied tap (a card missing from its list may be a
--    member enrolled after the last sync, and queueing it would record a visit
--    for a tap the door refused).

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
    select mc.card_uid, mc.member_id, (m.archived_at is not null) as archived
    from public.member_cards mc
    join public.members m on m.id = mc.member_id
    where mc.org_id = v_device.org_id
      and mc.revoked_at is null
      and (v_after is null or mc.card_uid > v_after)
    order by mc.card_uid
    limit v_limit + 1
  loop
    v_seen := v_seen + 1;
    if v_seen > v_limit then
      v_more := true;
      exit;
    end if;
    v_last := v_row.card_uid;
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
  v_snap record;
  v_tz text;
  v_today date;
  v_shift integer;
  v_accepted integer := 0;
  v_duplicate integer := 0;
  v_unknown integer := 0;
  v_clamped integer := 0;
  v_bad integer := 0;
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

  for v_ev in select e from jsonb_array_elements(p_events) as e
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
    'bad_uid', v_bad
  );
end;
$$;

revoke execute on function public.rfid_sync_cards(text, text, integer)
  from public, anon, authenticated;
revoke execute on function public.rfid_log_offline(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.rfid_sync_cards(text, text, integer) to service_role;
grant execute on function public.rfid_log_offline(text, jsonb) to service_role;
