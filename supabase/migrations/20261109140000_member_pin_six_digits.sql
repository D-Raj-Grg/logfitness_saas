-- A member's PIN is exactly six digits (was 4 to 6). The members' app now shows
-- six boxes and signs in on the sixth digit. Generated PINs were already six
-- digits; only a desk-typed custom PIN is affected. verify_member_pin just
-- compares, so it stays as is; existing PINs are hashes and are not touched.
-- Body is the live set_member_pin (staff-linked guard, audit, reset of
-- failed_attempts / locked_until / lock_level) with only the PIN check changed.

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
  elsif v_pin !~ '^[0-9]{6}$' then
    raise exception 'A PIN is exactly 6 digits' using errcode = 'check_violation';
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

revoke all on function public.set_member_pin(uuid, text) from public, anon;
grant execute on function public.set_member_pin(uuid, text) to authenticated;
