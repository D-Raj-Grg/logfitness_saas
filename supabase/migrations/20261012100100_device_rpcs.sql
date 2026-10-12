-- RFID check-in, part 2 -- managing readers. devices has no write policy, so
-- these three security definer RPCs are the only way in. Each one reads the
-- caller's role and branch reach from the JWT itself and refuses anyone who is
-- not an owner, or a manager of the reader's branch.
--
-- The device key is 'lgd_' plus 32 random bytes in base64url. It is returned
-- in the response exactly once; only its sha256 is stored. Losing it means
-- rotating it, by design.

-- Shared by register and rotate. Internal: not callable from PostgREST.
create or replace function public.new_device_key()
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select 'lgd_' || rtrim(
    translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'),
    '='
  );
$$;

create or replace function public.register_device(
  p_branch_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := public.jwt_org_id();
  v_staff_id uuid := public.jwt_staff_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_key text;
  v_id uuid;
begin
  if v_org_id is null
     or v_staff_id is null
     or not (
       public.jwt_is_owner()
       or public.jwt_staff_role() = 'manager'::public.staff_role
     )
  then
    raise exception 'Only an owner or manager can register a device'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.branches b
    where b.id = p_branch_id and b.org_id = v_org_id
  ) or not public.has_branch_access(p_branch_id) then
    raise exception 'Branch not found' using errcode = 'no_data_found';
  end if;

  if length(v_name) not between 1 and 60 then
    raise exception 'A device name is 1 to 60 characters'
      using errcode = 'check_violation';
  end if;

  v_key := public.new_device_key();

  begin
    insert into public.devices (
      org_id, branch_id, name, key_hash, key_prefix, created_by
    )
    values (
      v_org_id, p_branch_id, v_name,
      encode(extensions.digest(v_key, 'sha256'), 'hex'),
      left(v_key, 8),
      v_staff_id
    )
    returning id into v_id;
  exception when unique_violation then
    raise exception 'A device called % already exists', v_name
      using errcode = 'unique_violation';
  end;

  return jsonb_build_object('device_id', v_id, 'name', v_name, 'key', v_key);
end;
$$;

create or replace function public.rotate_device_key(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.devices%rowtype;
  v_key text;
begin
  select * into v_device
  from public.devices d
  where d.id = p_device_id and d.org_id = public.jwt_org_id();

  if not found or not public.has_branch_access(v_device.branch_id) then
    raise exception 'Device not found' using errcode = 'no_data_found';
  end if;

  if public.jwt_staff_id() is null
     or not (
       public.jwt_is_owner()
       or public.jwt_staff_role() = 'manager'::public.staff_role
     )
  then
    raise exception 'Only an owner or manager can rotate a device key'
      using errcode = 'insufficient_privilege';
  end if;

  v_key := public.new_device_key();

  update public.devices d
  set key_hash = encode(extensions.digest(v_key, 'sha256'), 'hex'),
      key_prefix = left(v_key, 8)
  where d.id = v_device.id;

  return jsonb_build_object('device_id', v_device.id, 'key', v_key);
end;
$$;

-- Rename and/or enable/disable. Null means "leave as is". Returns the row
-- without key_hash.
create or replace function public.update_device(
  p_device_id uuid,
  p_name text default null,
  p_status public.device_status default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.devices%rowtype;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  select * into v_device
  from public.devices d
  where d.id = p_device_id and d.org_id = public.jwt_org_id();

  if not found or not public.has_branch_access(v_device.branch_id) then
    raise exception 'Device not found' using errcode = 'no_data_found';
  end if;

  if public.jwt_staff_id() is null
     or not (
       public.jwt_is_owner()
       or public.jwt_staff_role() = 'manager'::public.staff_role
     )
  then
    raise exception 'Only an owner or manager can change a device'
      using errcode = 'insufficient_privilege';
  end if;

  if v_name is not null and length(v_name) > 60 then
    raise exception 'A device name is 1 to 60 characters'
      using errcode = 'check_violation';
  end if;

  begin
    update public.devices d
    set name = coalesce(v_name, d.name),
        status = coalesce(p_status, d.status)
    where d.id = v_device.id
    returning * into v_device;
  exception when unique_violation then
    raise exception 'A device called % already exists', v_name
      using errcode = 'unique_violation';
  end;

  return to_jsonb(v_device) - 'key_hash';
end;
$$;

-- Grant hygiene: Supabase hands EXECUTE on new public functions to anon and
-- authenticated by default. new_device_key is internal to the definers above.
revoke execute on function public.new_device_key() from public, anon, authenticated;
revoke execute on function public.register_device(uuid, text) from public, anon;
revoke execute on function public.rotate_device_key(uuid) from public, anon;
revoke execute on function public.update_device(uuid, text, public.device_status) from public, anon;

grant execute on function public.register_device(uuid, text) to authenticated;
grant execute on function public.rotate_device_key(uuid) to authenticated;
grant execute on function public.update_device(uuid, text, public.device_status) to authenticated;
