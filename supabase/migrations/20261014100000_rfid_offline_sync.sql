-- RFID offline mode. The reader keeps a local copy of "which cards may enter,
-- until when" and decides from it when the network is down, then uploads the
-- taps it let in once the network is back.
--
--   rfid_sync_cards   -- the allow-list, one page at a time (keyset on card_uid)
--   rfid_log_offline  -- backfill door taps that were decided on the reader
--
-- Both are called by the rfid-sync Edge Function with the service-role key on
-- behalf of a device that has no JWT, exactly like rfid_check_in: security
-- definer, service_role only, org and branch derived from the device key hash
-- alone. Nothing in the request is trusted for org, branch or member.
--
-- The allow-list applies the same rule rfid_check_in does (step 5): a live
-- card, a member who has not left, banner active/expiring, nothing owing. It
-- calls attendance_snapshot() per member so the reader and the desk cannot
-- drift apart. A card that fails the rule is simply absent -- the reader treats
-- absent as "not allowed" once its next sync lands.

-- Far-future stand-in for a membership with no end date (session packs). The
-- reader stores days-since-epoch in a uint16, which tops out in 2149.
create or replace function public.rfid_open_ended_date()
returns date
language sql
immutable
security invoker
set search_path = ''
as $$ select date '2099-12-31'; $$;

-- One page of the allow-list. p_after is the last card_uid of the previous
-- page (null for the first). `more` is true when another page follows; pages
-- are cut on candidate cards, so a page may carry fewer than p_limit allowed
-- rows (revoked/owing cards are skipped, not counted against the next page).
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

    if v_row.archived then
      continue;
    end if;

    select * into v_snap from public.attendance_snapshot(v_row.member_id);
    if not found then
      continue;
    end if;

    if v_snap.banner in ('active', 'expiring') and coalesce(v_snap.due_paisa, 0) = 0 then
      v_cards := v_cards || jsonb_build_array(jsonb_build_array(
        v_row.card_uid,
        to_char(
          case
            when v_snap.days_to_expiry is null then v_open_ended
            else v_today + v_snap.days_to_expiry
          end,
          'YYYYMMDD'
        )
      ));
    end if;
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

-- Backfill taps the reader decided offline. p_events is a jsonb array of
-- { "uid": "04A31B2C", "ts": "2026-10-14T05:12:00Z" | null }, at most 100.
--
--   known live card   -> attendance row, method 'card', checked_in_at = ts.
--                        The membership snapshot is taken now, not at ts: the
--                        reader already let the member in, and this is the
--                        record of that, not a fresh judgement.
--   unknown card      -> the enrollment inbox, so a tap on an unassigned card
--                        made while offline is not lost.
--   already in today  -> duplicate (the partial unique index is the arbiter, so
--                        a retried batch cannot double-count).
--
-- A missing ts, or one more than 5 minutes ahead of now or older than 7 days,
-- is not evidence; the event is recorded at now() and counted as `clamped`.
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
        v_snap.membership_status, v_snap.days_to_expiry, coalesce(v_snap.due_paisa, 0),
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

-- Grant hygiene: service role only. A signed-in user calling either would be a
-- device impersonator.
revoke execute on function public.rfid_open_ended_date() from public, anon;
grant execute on function public.rfid_open_ended_date() to authenticated, service_role;

revoke execute on function public.rfid_sync_cards(text, text, integer)
  from public, anon, authenticated;
revoke execute on function public.rfid_log_offline(text, jsonb)
  from public, anon, authenticated;

grant execute on function public.rfid_sync_cards(text, text, integer) to service_role;
grant execute on function public.rfid_log_offline(text, jsonb) to service_role;
