-- Owner-editable org preferences. orgs.settings is a jsonb bag read by SQL
-- helpers (class_cancellation_window_minutes, org_notification_locale); a
-- direct orgs UPDATE from a client would replace the whole bag, so writes go
-- through this allow-listed, merge-only RPC.
create or replace function public.set_org_setting(_key text, _value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.jwt_org_id();
  v_int integer;
  v_result jsonb;
begin
  if v_org is null or not public.jwt_is_owner() then
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
