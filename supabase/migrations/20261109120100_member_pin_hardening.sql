-- Hardening for member PIN login (review fixes).
--
-- 1. Escalating lockout: the 5-failure counter still resets when a lock starts,
--    but the lock length doubles each time (15 min * 2^lock_level, level capped
--    at 6, about 16 hours) so a 4-6 digit PIN cannot be ground down at five
--    tries per quarter hour forever. A correct PIN or a desk set/clear resets
--    the level.
-- 2. set_member_pin refuses a member whose auth user is also a staff login:
--    member-login would otherwise mint a session for that account.

alter table public.member_pins
  add column if not exists lock_level integer not null default 0;

create or replace function public.verify_member_pin(p_member_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_dummy constant text := '$2a$08$8thlVjaMrDHLDartqStKbuhgAQl47Dx.eDuIfTwv7xJMuFz6pKbg6';
  v_row public.member_pins%rowtype;
  v_have boolean;
  v_match boolean;
  v_attempts integer;
  v_secs integer;
begin
  select * into v_row from public.member_pins where member_id = p_member_id for update;
  v_have := found;

  v_match := extensions.crypt(coalesce(p_pin, ''), case when v_have then v_row.pin_hash else c_dummy end)
             = case when v_have then v_row.pin_hash else c_dummy end;

  if not v_have then
    return jsonb_build_object('result', 'invalid');
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object(
      'result', 'locked',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_row.locked_until - now())))::integer)
    );
  end if;

  if v_match then
    if v_row.failed_attempts <> 0 or v_row.locked_until is not null or v_row.lock_level <> 0 then
      update public.member_pins
      set failed_attempts = 0, locked_until = null, lock_level = 0
      where member_id = p_member_id;
    end if;
    return jsonb_build_object('result', 'ok');
  end if;

  v_attempts := v_row.failed_attempts + 1;
  if v_attempts >= 5 then
    v_secs := 900 * (1 << least(v_row.lock_level, 6));
    update public.member_pins
    set failed_attempts = 0,
        locked_until = now() + make_interval(secs => v_secs),
        lock_level = v_row.lock_level + 1
    where member_id = p_member_id;
    return jsonb_build_object('result', 'locked', 'retry_after_seconds', v_secs);
  end if;

  update public.member_pins set failed_attempts = v_attempts
  where member_id = p_member_id;
  return jsonb_build_object('result', 'invalid');
end;
$$;

create or replace function public.set_member_pin(p_member_id uuid, p_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members%rowtype;
  v_pin text := p_pin;
  v_generated boolean := p_pin is null;
  v_had boolean;
begin
  v_member := public.member_pin_authorize(p_member_id);

  if v_member.auth_user_id is not null
     and exists (select 1 from public.staff s where s.auth_user_id = v_member.auth_user_id)
  then
    raise exception 'This member''s app account is also a staff login; a PIN cannot be set'
      using errcode = 'insufficient_privilege';
  end if;

  if v_pin is null then
    v_pin := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  elsif v_pin !~ '^[0-9]{4,6}$' then
    raise exception 'A PIN is 4 to 6 digits' using errcode = 'check_violation';
  end if;

  select exists (select 1 from public.member_pins where member_id = p_member_id) into v_had;

  insert into public.member_pins (member_id, org_id, pin_hash, failed_attempts, locked_until, lock_level, set_by, set_at)
  values (p_member_id, v_member.org_id, extensions.crypt(v_pin, extensions.gen_salt('bf', 8)),
          0, null, 0, public.jwt_staff_id(), now())
  on conflict (member_id) do update
    set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null, lock_level = 0,
        set_by = excluded.set_by, set_at = excluded.set_at;

  perform public.member_pin_audit(v_member, v_had, true);

  if v_generated then
    return jsonb_build_object('result', 'ok', 'pin', v_pin);
  end if;
  return jsonb_build_object('result', 'ok');
end;
$$;

-- create or replace keeps the grants, but restate them so the file stands alone.
revoke all on function public.verify_member_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.verify_member_pin(uuid, text) to service_role;
revoke all on function public.set_member_pin(uuid, text) from public, anon;
grant execute on function public.set_member_pin(uuid, text) to authenticated;
