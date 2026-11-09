-- set_org_setting let a MEMBER through.
--
-- The guard was `if v_org is null or not public.jwt_is_owner() then raise`. For a
-- member principal jwt_staff_role() is null, so jwt_is_owner() is null, `not null`
-- is null, and `false or null` is null: plpgsql treats a null condition as false
-- and skips the raise. A signed-in member (whose JWT carries org_id) could
-- therefore change their gym's settings. Same shape as the previous version,
-- with the role test made null-safe. Nothing else changes.

create or replace function public.set_org_setting(_key text, _value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.jwt_org_id();
  v_int integer;
  v_text text;
  v_days integer[];
  v_result jsonb;
begin
  if v_org is null
     or not (
       coalesce(public.jwt_is_owner(), false)
       or (_key = 'weekly_off'
           and coalesce(public.jwt_staff_role() = 'manager'::public.staff_role, false))
     )
  then
    raise exception 'Only the owner can change gym preferences'
      using errcode = '42501';
  end if;

  if _key = 'class_cancellation_window_minutes' then
    if _value is null or jsonb_typeof(_value) <> 'number'
       or (_value #>> '{}') !~ '^[0-9]+$' then
      raise exception 'class_cancellation_window_minutes must be a whole number of minutes'
        using errcode = '22023';
    end if;
    v_int := (_value #>> '{}')::integer;
    if v_int < 0 or v_int > 10080 then
      raise exception 'class_cancellation_window_minutes must be between 0 and 10080'
        using errcode = '22023';
    end if;
  elsif _key = 'notification_locale' then
    if _value is null or jsonb_typeof(_value) <> 'string'
       or (_value #>> '{}') not in ('en', 'ne') then
      raise exception 'notification_locale must be "en" or "ne"'
        using errcode = '22023';
    end if;
  elsif _key = 'track_check_out' then
    if _value is null or jsonb_typeof(_value) <> 'boolean' then
      raise exception 'track_check_out must be true or false'
        using errcode = '22023';
    end if;
  elsif _key = 'balance_url' then
    if _value is not null and jsonb_typeof(_value) <> 'null' then
      if jsonb_typeof(_value) <> 'string' then
        raise exception 'balance_url must be a link or null' using errcode = '22023';
      end if;
      v_text := btrim(_value #>> '{}');
      if length(v_text) > 200
         or (v_text !~ '^https://[^\s]+$' and v_text !~ '^http://localhost(:[0-9]+)?(/[^\s]*)?$')
      then
        raise exception 'balance_url must be an https:// link of at most 200 characters'
          using errcode = '22023';
      end if;
      if v_text ~ '[?&]card_no=' then
        raise exception 'balance_url must not carry card_no itself; the card number is added to it'
          using errcode = '22023';
      end if;
      _value := to_jsonb(v_text);
    else
      _value := 'null'::jsonb;
    end if;
  elsif _key = 'weekly_off' then
    -- A JSON array of ISO weekdays, 1 (Monday) to 7 (Sunday). [] means the gym
    -- is open every day. Stored sorted and deduplicated.
    if _value is null or jsonb_typeof(_value) <> 'array' then
      raise exception 'weekly_off must be a list of weekdays, each 1 (Monday) to 7 (Sunday)'
        using errcode = '22023';
    end if;
    if jsonb_array_length(_value) > 7
       or exists (
         select 1 from jsonb_array_elements(_value) e
         where jsonb_typeof(e) <> 'number' or (e #>> '{}') !~ '^[1-7]$'
       )
    then
      raise exception 'weekly_off must be a list of weekdays, each 1 (Monday) to 7 (Sunday)'
        using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct (e #>> '{}')::integer order by (e #>> '{}')::integer), '{}')
      into v_days
    from jsonb_array_elements(_value) e;
    _value := to_jsonb(v_days);
  else
    raise exception 'Unknown setting: %', _key using errcode = '22023';
  end if;

  update public.orgs
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array[_key], _value, true)
   where id = v_org
  returning settings into v_result;

  return v_result;
end;
$$;

revoke all on function public.set_org_setting(text, jsonb) from public, anon;
grant execute on function public.set_org_setting(text, jsonb) to authenticated;
