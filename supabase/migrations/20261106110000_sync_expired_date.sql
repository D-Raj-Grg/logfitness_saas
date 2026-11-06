-- The reader's cached list now carries two more things per card.
--
-- 1. The END DATE for an expired card. rfid_sync_cards sent '00000000' for every
--    status except 'A' (allowed). The reader's new result screen shows
--    "EXPIRED ON <date>", so an offline reader needs the day the membership
--    ended: today + days_to_expiry (negative once a membership has ended).
-- 2. The holder's NAME (a 4th element), so a reader can greet people by name
--    from its cache without asking the server. Folded to what the OLED can show
--    (printable ASCII, one '?' per other character, as the firmware's
--    copyDisplayText does), commas and line breaks removed, at most 20
--    characters. It is the last field of the line, so older firmware that stops
--    after the status letter ignores it.
--
-- Readers on older firmware ignore both. Changed from
-- 20261106100000_staff_cards_offline.sql: the union carries full_name, the
-- 'expired' branch sets v_until, and every list entry gets the name.

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
  v_name text;
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
    select u.card_uid, u.member_id, u.archived, u.is_staff, u.full_name
    from (
      select mc.card_uid, mc.member_id, (m.archived_at is not null) as archived,
             false as is_staff, m.full_name
      from public.member_cards mc
      join public.members m on m.id = mc.member_id
      where mc.org_id = v_device.org_id
        and mc.revoked_at is null
      union all
      -- Only staff who may clock in at THIS door: active, and an owner (works
      -- anywhere) or a branch on their staff row. Anyone else gets no line, so
      -- the reader answers unknown, as the online staff_wrong_branch would deny.
      select sc.card_uid, null::uuid, false, true, s.full_name
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
    v_name := left(btrim(regexp_replace(
      replace(replace(replace(coalesce(v_row.full_name, ''), ',', ' '), chr(10), ' '), chr(13), ' '),
      '[^ -~]', '?', 'g')), 20);

    if v_row.is_staff then
      -- No expiry for staff: the open-ended date, like a membership with no end.
      v_cards := v_cards || jsonb_build_array(jsonb_build_array(
        v_row.card_uid, to_char(v_open_ended, 'YYYYMMDD'), 'S', v_name
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
      -- An expired card carries the day its membership ended, so the reader can
      -- show "EXPIRED ON 12 OCT 2026" while offline. Other states keep 00000000.
      if v_code = 'E' and v_snap.days_to_expiry is not null and v_snap.days_to_expiry < 0 then
        v_until := to_char(v_today + v_snap.days_to_expiry, 'YYYYMMDD');
      end if;
    end if;

    v_cards := v_cards || jsonb_build_array(jsonb_build_array(v_row.card_uid, v_until, v_code, v_name));
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

revoke execute on function public.rfid_sync_cards(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.rfid_sync_cards(text, text, integer) to service_role;
