-- The reader's offline list now carries every live card with a status, not just
-- the allowed ones, so the OLED can say EXPIRED / FROZEN / PAY DUES / NOT A
-- MEMBER offline instead of a generic "not on list". A card absent from the list
-- is genuinely unknown.
--
-- Entry = [card_uid, until, code]
--   code  A allowed      until = last day it may enter (2099-12-31 if open-ended)
--         D dues owing   (rfid_check_in's 'dues' reason: owed money wins over banner)
--         E expired      F frozen   U not started   N no membership   L left / archived
--   until is '00000000' for everything except A.
--
-- Same rule as rfid_check_in steps 4-5: archived members are 'left' whatever
-- their last membership says, and allowed = banner active/expiring with nothing
-- owing. Still calls attendance_snapshot() per member so reader and desk cannot
-- drift apart.

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

    if v_row.archived then
      v_code := 'L';
    else
      select * into v_snap from public.attendance_snapshot(v_row.member_id);
      if not found then
        continue;
      end if;
      v_banner := v_snap.banner;

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

revoke execute on function public.rfid_sync_cards(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.rfid_sync_cards(text, text, integer) to service_role;
