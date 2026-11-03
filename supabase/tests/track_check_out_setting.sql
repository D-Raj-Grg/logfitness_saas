-- orgs.settings.track_check_out: check-out recording is OFF unless an owner turns
-- it on. Only a real boolean is accepted, only an owner may set it, and one gym's
-- setting never touches another's.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/track_check_out_setting.sql

do $$
declare
  org_a uuid := 'd1d1d1d1-1111-1111-1111-111111111111';
  org_b uuid := 'd2d2d2d2-2222-2222-2222-222222222222';
  br_a uuid := 'd1b00000-0000-0000-0000-000000000001';
  st_owner uuid := 'd1000000-0000-0000-0000-00000000000f';
  st_mgr   uuid := 'd1000000-0000-0000-0000-00000000000a';
  st_b_owner uuid := 'd2000000-0000-0000-0000-00000000000f';
  failed boolean;
  v jsonb;
begin
  insert into public.orgs (id, name, slug) values
    (org_a, 'Phi Fitness', 'phi-fitness-test'),
    (org_b, 'Chi Gyms', 'chi-gyms-test');
  insert into public.branches (id, org_id, name) values (br_a, org_a, 'Phi One');
  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_owner, org_a, 'Phi Owner', 'owner@phi.test', 'owner', '{}', 'active'),
    (st_mgr, org_a, 'Phi Manager', 'mgr@phi.test', 'manager', array[br_a], 'active'),
    (st_b_owner, org_b, 'Chi Owner', 'owner@chi.test', 'owner', '{}', 'active');

  -- a new gym has no value, which the app reads as OFF
  assert (select settings -> 'track_check_out' from public.orgs where id = org_a) is null,
    'a new gym already has a check-out value';

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  v := public.set_org_setting('track_check_out', 'true'::jsonb);
  assert v -> 'track_check_out' = 'true'::jsonb, 'the owner could not turn check-out on';
  v := public.set_org_setting('track_check_out', 'false'::jsonb);
  assert v -> 'track_check_out' = 'false'::jsonb, 'the owner could not turn check-out off';

  -- the other settings still work and keep their value
  v := public.set_org_setting('notification_locale', '"ne"'::jsonb);
  assert v ->> 'notification_locale' = 'ne' and v -> 'track_check_out' = 'false'::jsonb,
    'saving another setting disturbed the check-out one';

  -- only a real boolean
  failed := false;
  begin
    perform public.set_org_setting('track_check_out', '"yes"'::jsonb);
  exception when invalid_parameter_value then failed := true;
  end;
  assert failed, 'a string was accepted as the check-out setting';
  failed := false;
  begin
    perform public.set_org_setting('track_check_out', '1'::jsonb);
  exception when invalid_parameter_value then failed := true;
  end;
  assert failed, 'a number was accepted as the check-out setting';

  -- owner only
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_mgr::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(br_a::text)
  )::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin
    perform public.set_org_setting('track_check_out', 'true'::jsonb);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a manager changed the check-out setting';

  -- another gym's owner turning it on leaves this gym alone
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  perform public.set_org_setting('track_check_out', 'true'::jsonb);

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  assert (select settings -> 'track_check_out' from public.orgs where id = org_a) = 'false'::jsonb,
    'one gym''s setting changed another''s';
  assert (select settings -> 'track_check_out' from public.orgs where id = org_b) = 'true'::jsonb,
    'the second gym''s setting was not saved';

  delete from public.orgs where id in (org_a, org_b);
  raise notice 'track_check_out setting: all assertions passed';
end $$;
