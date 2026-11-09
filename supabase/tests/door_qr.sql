-- Door-display QR check-in: the code function (with a published test vector the
-- firmware must reproduce), member_door_check_in (valid / +-1 window / stale /
-- future / wrong device / other org / disabled / opening hours / denied reasons /
-- already checked in / throttle), the unlock-request queue (consumed once,
-- expires at 20 s, per device), rfid_qr_config, rotate_device_key, and who may
-- call or read what.
--
-- Seeds two orgs, drives the real RPCs as real personas, asserts, then removes
-- its fixtures. A failed assertion aborts.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/door_qr.sql

do $$
declare
  org_a uuid := 'c1c1c1c1-1111-1111-1111-111111111111';
  org_b uuid := 'c2c2c2c2-2222-2222-2222-222222222222';
  br_a1 uuid := 'c1b00000-0000-0000-0000-000000000001';
  br_a2 uuid := 'c1b00000-0000-0000-0000-000000000002';
  br_b1 uuid := 'c2b00000-0000-0000-0000-000000000001';
  st_owner uuid := 'c1000000-0000-0000-0000-00000000000f';
  st_desk  uuid := 'c1000000-0000-0000-0000-00000000000d';
  st_b_owner uuid := 'c2000000-0000-0000-0000-00000000000f';

  plan_a uuid;
  m_ok uuid; m_bad uuid; m_thr uuid; m_exp uuid; m_due uuid; m_frozen uuid; m_b uuid;
  dev_a1 uuid; dev_a2 uuid; dev_b uuid;
  key_a1 text; key_a2 text; key_b text;
  hash_a1 text; hash_a2 text; hash_b text;
  sec_a1 bytea; sec_a2 bytea; sec_b bytea;
  w bigint;
  c_cur text; c_m1 text; c_p1 text; c_m2 text; c_p2 text;
  today_a date;
  result jsonb;
  n integer;
  failed boolean;
  v_local time;
begin
  -- 0. the published test vector --------------------------------------------------
  assert public.door_qr_code(
      decode('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex'),
      7, 56789012) = '06036629',
    'door_qr_code no longer matches the published test vector';
  assert public.door_qr_code(
      decode('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex'),
      7, 56789013) = '61789799',
    'door_qr_code vector for the next window is wrong';
  assert public.door_qr_code(
      decode('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex'),
      1, 0) = '75481906',
    'door_qr_code vector for window 0 is wrong';

  -- the existing readers all got a number and a secret in the migration
  assert not exists (
    select 1 from public.devices d
    where d.qr_id is null
       or not exists (select 1 from public.device_qr_secrets s where s.device_id = d.id)
  ), 'a device has no qr_id or no qr secret';

  -- fixtures ---------------------------------------------------------------------
  insert into public.orgs (id, name, slug) values
    (org_a, 'Chi Fitness', 'chi-doorqr-test'),
    (org_b, 'Psi Gyms', 'psi-doorqr-test');
  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Chi One'), (br_a2, org_a, 'Chi Two'), (br_b1, org_b, 'Psi One');
  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_owner, org_a, 'Chi Owner', 'owner@chi.test', 'owner', '{}', 'active'),
    (st_desk,  org_a, 'Chi Desk',  'desk@chi.test',  'front_desk', array[br_a1], 'active'),
    (st_b_owner, org_b, 'Psi Owner', 'owner@psi.test', 'owner', '{}', 'active');

  today_a := public.org_today(org_a);

  insert into public.membership_plans (org_id, name, plan_type, duration_days, price_paisa)
  values (org_a, 'Monthly', 'time', 30, 250000) returning id into plan_a;

  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
    values (org_a, br_a1, 'Qr Ok', '9850000001', st_owner) returning id into m_ok;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
    values (org_a, br_a1, 'Qr Bad', '9850000002', st_owner) returning id into m_bad;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
    values (org_a, br_a1, 'Qr Throttle', '9850000003', st_owner) returning id into m_thr;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
    values (org_a, br_a1, 'Qr Expired', '9850000004', st_owner) returning id into m_exp;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
    values (org_a, br_a1, 'Qr Dues', '9850000005', st_owner) returning id into m_due;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
    values (org_a, br_a1, 'Qr Frozen', '9850000006', st_owner) returning id into m_frozen;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
    values (org_b, br_b1, 'Qr Other Org', '9850000007', st_b_owner) returning id into m_b;

  insert into public.memberships
    (org_id, branch_id, member_id, plan_id, plan_name, plan_type,
     start_date, end_date, price_paisa, status, frozen_on)
  values
    (org_a, br_a1, m_ok,     plan_a, 'Monthly', 'time', today_a - 5,  today_a + 25, 250000, 'active',  null),
    (org_a, br_a1, m_bad,    plan_a, 'Monthly', 'time', today_a - 5,  today_a + 25, 250000, 'active',  null),
    (org_a, br_a1, m_thr,    plan_a, 'Monthly', 'time', today_a - 5,  today_a + 25, 250000, 'active',  null),
    (org_a, br_a1, m_exp,    plan_a, 'Monthly', 'time', today_a - 40, today_a - 10, 250000, 'expired', null),
    (org_a, br_a1, m_frozen, plan_a, 'Monthly', 'time', today_a - 5,  today_a + 25, 250000, 'frozen',  today_a - 1);

  -- owner registers readers; the 2nd one in org A gets qr_id 2; org B restarts at 1
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  result := public.renew_membership(m_due, plan_a, br_a1, today_a, 0, 0, 'cash');

  result := public.register_device(br_a1, 'Door one');
  dev_a1 := (result ->> 'device_id')::uuid; key_a1 := result ->> 'key';
  hash_a1 := encode(extensions.digest(key_a1, 'sha256'), 'hex');
  result := public.register_device(br_a2, 'Door two');
  dev_a2 := (result ->> 'device_id')::uuid; key_a2 := result ->> 'key';
  hash_a2 := encode(extensions.digest(key_a2, 'sha256'), 'hex');

  -- staff never see the secret through a device row or update_device
  assert not exists (
    select 1 from public.devices d where to_jsonb(d) ? 'qr_secret'
  ), 'a devices row carries a qr_secret';
  result := public.update_device(dev_a1, 'Door one', 'active');
  assert position('secret' in result::text) = 0, 'update_device leaked a secret';

  select d.qr_id into n from public.devices d where d.id = dev_a1;
  assert n = 1, format('the first device in the org got qr_id %s', n);
  select d.qr_id into n from public.devices d where d.id = dev_a2;
  assert n = 2, format('the second device in the org got qr_id %s', n);

  failed := false;
  begin
    perform 1 from public.device_qr_secrets;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'staff could read device_qr_secrets';
  failed := false;
  begin
    perform 1 from public.device_unlock_requests;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'staff could read device_unlock_requests';
  failed := false;
  begin
    perform 1 from public.door_qr_failures;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'staff could read door_qr_failures';

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  result := public.register_device(br_b1, 'Door b');
  dev_b := (result ->> 'device_id')::uuid; key_b := result ->> 'key';
  hash_b := encode(extensions.digest(key_b, 'sha256'), 'hex');
  select d.qr_id into n from public.devices d where d.id = dev_b;
  assert n = 1, 'org B did not restart at qr_id 1';

  -- grants -----------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  assert not has_function_privilege('anon', 'public.member_door_check_in(text)', 'execute'),
    'anon can call member_door_check_in';
  assert has_function_privilege('authenticated', 'public.member_door_check_in(text)', 'execute'),
    'authenticated cannot call member_door_check_in';
  assert not has_function_privilege('authenticated', 'public.rfid_poll_unlock(text)', 'execute')
     and not has_function_privilege('anon', 'public.rfid_poll_unlock(text)', 'execute'),
    'a client can call rfid_poll_unlock';
  assert has_function_privilege('service_role', 'public.rfid_poll_unlock(text)', 'execute'),
    'service_role cannot call rfid_poll_unlock';
  assert not has_function_privilege('authenticated', 'public.rfid_qr_config(text)', 'execute')
     and not has_function_privilege('anon', 'public.rfid_qr_config(text)', 'execute'),
    'a client can call rfid_qr_config';
  assert not has_function_privilege('authenticated', 'public.door_qr_code(bytea, integer, bigint)', 'execute')
     and not has_function_privilege('anon', 'public.door_qr_code(bytea, integer, bigint)', 'execute'),
    'a client can call door_qr_code';
  assert not has_function_privilege('authenticated', 'public.door_member_tap(uuid, uuid, public.attendance_method)', 'execute')
     and not has_function_privilege('anon', 'public.door_member_tap(uuid, uuid, public.attendance_method)', 'execute')
     and not has_function_privilege('service_role', 'public.door_member_tap(uuid, uuid, public.attendance_method)', 'execute'),
    'the shared door helper is callable from outside';
  assert not has_table_privilege('authenticated', 'public.device_qr_secrets', 'select')
     and not has_table_privilege('anon', 'public.device_qr_secrets', 'select')
     and not has_table_privilege('authenticated', 'public.device_unlock_requests', 'select')
     and not has_table_privilege('anon', 'public.device_unlock_requests', 'select')
     and not has_table_privilege('authenticated', 'public.door_qr_failures', 'select'),
    'a client holds a grant on an internal door table';

  select s.qr_secret into sec_a1 from public.device_qr_secrets s where s.device_id = dev_a1;
  select s.qr_secret into sec_a2 from public.device_qr_secrets s where s.device_id = dev_a2;
  select s.qr_secret into sec_b  from public.device_qr_secrets s where s.device_id = dev_b;
  assert length(sec_a1) = 32 and sec_a1 <> sec_a2, 'device secrets are not 32 distinct bytes';

  -- 1. a valid scan opens, records a qr visit, queues one unlock -------------------
  w := floor(extract(epoch from now()) / 30);
  c_cur := public.door_qr_code(sec_a1, 1, w);
  c_m1  := public.door_qr_code(sec_a1, 1, w - 1);
  c_p1  := public.door_qr_code(sec_a1, 1, w + 1);
  c_m2  := public.door_qr_code(sec_a1, 1, w - 2);
  c_p2  := public.door_qr_code(sec_a1, 1, w + 2);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m_ok::text, 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';

  result := public.member_door_check_in('LG1.1.' || c_cur);
  assert result ->> 'result' = 'ok', format('a valid scan: %s', result);
  assert result ->> 'member_name' = 'Qr Ok' and (result ->> 'days_to_expiry')::int = 25
     and (result ->> 'due_paisa')::bigint = 0
     and (result ->> 'already_checked_in_today')::boolean = false
     and result ->> 'reason' is null,
    format('a valid scan answered wrongly: %s', result);

  execute 'reset role';
  select count(*) into n from public.attendance a
  where a.member_id = m_ok and a.method = 'qr'::public.attendance_method
    and a.device_id = dev_a1 and a.attended_on = today_a and a.checked_in_by is null
    and a.branch_id = br_a1;
  assert n = 1, 'a valid scan did not write one qr attendance row with the device';
  select count(*) into n from public.device_unlock_requests r
  where r.device_id = dev_a1 and r.member_id = m_ok and r.consumed_at is null;
  assert n = 1, 'a valid scan did not queue one unlock request';

  -- 2. scanning again: still opens, no second visit, another unlock ------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m_ok::text, 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';
  result := public.member_door_check_in('LG1.1.' || c_m1);   -- previous window is fine
  assert result ->> 'result' = 'ok' and (result ->> 'already_checked_in_today')::boolean,
    format('a second scan: %s', result);
  result := public.member_door_check_in('LG1.1.' || c_p1);   -- next window is fine
  assert result ->> 'result' = 'ok', format('a +1 window scan: %s', result);
  execute 'reset role';
  select count(*) into n from public.attendance a where a.member_id = m_ok and a.attended_on = today_a;
  assert n = 1, 'a repeat scan made a second attendance row';

  -- 3. the reader polls: one unlock, then nothing; other device sees none -----------
  execute 'set local role service_role';
  result := public.rfid_poll_unlock(hash_a2);
  assert result ->> 'decision' = 'ok' and result -> 'unlock' = 'null'::jsonb,
    format('reader two saw reader one''s unlock: %s', result);
  result := public.rfid_poll_unlock(hash_a1);
  assert result ->> 'decision' = 'ok' and result #>> '{unlock,member_name}' = 'Qr Ok'
     and result #>> '{unlock,member_code}' is not null
     and (result #>> '{unlock,days_to_expiry}')::int = 25
     and result #>> '{unlock,status}' is not null
     and (result ->> 'server_time')::bigint > 1700000000,
    format('the poll did not return the unlock: %s', result);
  result := public.rfid_poll_unlock(hash_a1);
  assert result -> 'unlock' = 'null'::jsonb, 'the same unlock was handed out twice';
  result := public.rfid_poll_unlock('nope');
  assert result ->> 'reason' = 'device_unknown', 'poll with an unknown key';
  execute 'reset role';
  select count(*) into n from public.device_unlock_requests
  where device_id = dev_a1 and consumed_at is null;
  assert n = 0, 'all fresh requests should be consumed by one poll';

  -- 4. an unlock older than 20 s is never honoured ----------------------------------
  w := floor(extract(epoch from now()) / 30);
  c_cur := public.door_qr_code(sec_a1, 1, w);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m_ok::text, 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';
  result := public.member_door_check_in('LG1.1.' || c_cur);
  assert result ->> 'result' = 'ok', 'scan for the expiry test';
  execute 'reset role';
  update public.device_unlock_requests set created_at = now() - interval '25 seconds'
  where device_id = dev_a1 and consumed_at is null;
  execute 'set local role service_role';
  result := public.rfid_poll_unlock(hash_a1);
  assert result -> 'unlock' = 'null'::jsonb, 'a 25-second-old unlock opened the door';
  execute 'reset role';
  update public.device_unlock_requests set consumed_at = now()
  where device_id = dev_a1 and consumed_at is null;

  -- 5. stale / future / wrong-device / malformed codes are invalid -------------------
  w := floor(extract(epoch from now()) / 30);
  c_cur := public.door_qr_code(sec_a1, 1, w);
  c_m2  := public.door_qr_code(sec_a1, 1, w - 2);
  c_p2  := public.door_qr_code(sec_a1, 1, w + 2);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m_bad::text, 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';

  result := public.member_door_check_in('LG1.1.' || c_m2);
  assert result ->> 'result' = 'invalid_code', format('a 2-windows-old code: %s', result);
  result := public.member_door_check_in('LG1.1.' || c_p2);
  assert result ->> 'result' = 'invalid_code', format('a 2-windows-ahead code: %s', result);
  result := public.member_door_check_in('LG1.1.' || lpad(((c_cur::int + 1) % 100000000)::text, 8, '0'));
  assert result ->> 'result' = 'invalid_code', 'a wrong code';
  result := public.member_door_check_in('LG1.999.' || c_cur);
  assert result ->> 'result' = 'invalid_code', 'an unknown device number';
  execute 'reset role';
  select count(*) into n from public.attendance a where a.member_id = m_bad;
  assert n = 0, 'a bad code wrote attendance';
  select count(*) into n from public.device_unlock_requests r where r.member_id = m_bad;
  assert n = 0, 'a bad code queued an unlock';
  select count(*) into n from public.door_qr_failures f where f.member_id = m_bad;
  assert n = 4, format('bad codes were not all logged as failures (%s)', n);

  -- reader TWO's code presented for reader ONE's number
  w := floor(extract(epoch from now()) / 30);
  c_cur := public.door_qr_code(sec_a2, 1, w);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m_bad::text, 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';
  result := public.member_door_check_in('LG1.1.' || c_cur);
  assert result ->> 'result' = 'invalid_code', 'reader two''s code worked on reader one';

  -- 6. an org B member cannot use org A's reader or code -----------------------------
  execute 'reset role';
  w := floor(extract(epoch from now()) / 30);
  c_cur := public.door_qr_code(sec_a1, 1, w);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'member_id', m_b::text, 'branch_ids', json_build_array(br_b1)
  )::text, true);
  execute 'set local role authenticated';
  result := public.member_door_check_in('LG1.1.' || c_cur);   -- org B's own number 1
  assert result ->> 'result' = 'invalid_code', 'an org B member used org A''s code';
  execute 'reset role';
  select count(*) into n from public.attendance a where a.member_id = m_b;
  assert n = 0, 'an org B member got an attendance row';

  -- the same member with their OWN org's code is fine only if their membership
  -- is: m_b has none, so a valid org B code is denied, not invalid
  w := floor(extract(epoch from now()) / 30);
  c_cur := public.door_qr_code(sec_b, 1, w);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'member_id', m_b::text, 'branch_ids', json_build_array(br_b1)
  )::text, true);
  execute 'set local role authenticated';
  result := public.member_door_check_in('LG1.1.' || c_cur);
  assert result ->> 'result' = 'denied' and result ->> 'reason' = 'none',
    format('a member with no plan on their own reader: %s', result);

  -- 7. denied reasons: expired, dues, frozen -- no visit, no unlock -------------------
  execute 'reset role';
  w := floor(extract(epoch from now()) / 30);
  c_cur := public.door_qr_code(sec_a1, 1, w);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m_exp::text, 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';
  result := public.member_door_check_in('LG1.1.' || c_cur);
  assert result ->> 'result' = 'denied' and result ->> 'reason' = 'expired'
     and (result ->> 'days_to_expiry')::int = -10,
    format('an expired member: %s', result);

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m_due::text, 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';
  result := public.member_door_check_in('LG1.1.' || c_cur);
  assert result ->> 'result' = 'denied' and result ->> 'reason' = 'dues'
     and (result ->> 'due_paisa')::bigint > 0,
    format('a member who owes money: %s', result);

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m_frozen::text, 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';
  result := public.member_door_check_in('LG1.1.' || c_cur);
  assert result ->> 'result' = 'denied' and result ->> 'reason' = 'frozen',
    format('a frozen member: %s', result);

  execute 'reset role';
  select count(*) into n from public.attendance a where a.member_id in (m_exp, m_due, m_frozen);
  assert n = 0, 'a denied member got a visit';
  select count(*) into n from public.device_unlock_requests r where r.member_id in (m_exp, m_due, m_frozen);
  assert n = 0, 'a denied member queued an unlock';

  -- 8. a disabled reader is closed ----------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  perform public.update_device(dev_a1, null, 'disabled');
  execute 'reset role';

  w := floor(extract(epoch from now()) / 30);
  c_cur := public.door_qr_code(sec_a1, 1, w);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m_ok::text, 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';
  result := public.member_door_check_in('LG1.1.' || c_cur);
  assert result ->> 'result' = 'closed' and result ->> 'reason' = 'device_disabled',
    format('a disabled reader: %s', result);
  execute 'reset role';
  select count(*) into n from public.device_unlock_requests r
  where r.device_id = dev_a1 and r.consumed_at is null;
  assert n = 0, 'a disabled reader queued an unlock';
  execute 'set local role service_role';
  result := public.rfid_poll_unlock(hash_a1);
  assert result ->> 'reason' = 'device_disabled', 'a disabled reader polled';
  result := public.rfid_qr_config(hash_a1);
  assert result ->> 'reason' = 'device_disabled', 'a disabled reader fetched its QR secret';
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  perform public.update_device(dev_a1, null, 'active');
  execute 'reset role';

  -- 9. opening hours (org timezone) ------------------------------------------------------
  select (now() at time zone coalesce(o.timezone, 'Asia/Kathmandu'))::time
    into v_local from public.orgs o where o.id = org_a;

  -- reader two sits in branch two: closed an hour from now for an hour
  update public.branches set opens_at = (v_local + interval '1 hour')::time,
                             closes_at = (v_local + interval '2 hours')::time
  where id = br_a2;
  w := floor(extract(epoch from now()) / 30);
  c_cur := public.door_qr_code(sec_a2, 2, w);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m_ok::text, 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';
  result := public.member_door_check_in('LG1.2.' || c_cur);
  assert result ->> 'result' = 'closed' and result ->> 'reason' = 'outside_hours',
    format('outside opening hours: %s', result);
  execute 'reset role';
  select count(*) into n from public.device_unlock_requests r where r.device_id = dev_a2;
  assert n = 0, 'a closed branch queued an unlock';
  select count(*) into n from public.door_qr_failures f where f.member_id = m_ok;
  assert n = 0, 'a closed branch counted as a bad code';

  -- open from an hour ago to an hour ahead
  update public.branches set opens_at = (v_local - interval '1 hour')::time,
                             closes_at = (v_local + interval '1 hour')::time
  where id = br_a2;
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m_ok::text, 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';
  result := public.member_door_check_in('LG1.2.' || c_cur);
  assert result ->> 'result' = 'ok', format('inside opening hours: %s', result);
  execute 'reset role';

  -- one-sided hours: opens at midnight / closes at the last second -> open
  update public.branches set opens_at = '00:00', closes_at = null where id = br_a2;
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m_ok::text, 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';
  result := public.member_door_check_in('LG1.2.' || c_cur);
  assert result ->> 'result' = 'ok', format('opens_at only: %s', result);
  execute 'reset role';
  update public.branches set opens_at = null, closes_at = '23:59:58' where id = br_a2;
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m_ok::text, 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';
  result := public.member_door_check_in('LG1.2.' || c_cur);
  assert result ->> 'result' = 'ok', format('closes_at only: %s', result);
  execute 'reset role';

  -- both null = always open (reader one's branch has no hours)
  update public.branches set opens_at = null, closes_at = null where id = br_a2;
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m_ok::text, 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';
  result := public.member_door_check_in('LG1.2.' || c_cur);
  assert result ->> 'result' = 'ok', format('no hours set: %s', result);
  execute 'reset role';

  -- 10. throttle: 10 bad codes in 10 minutes, then even a good code is refused -------
  w := floor(extract(epoch from now()) / 30);
  c_cur := public.door_qr_code(sec_a1, 1, w);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m_thr::text, 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';
  for n in 1..10 loop
    result := public.member_door_check_in('LG1.1.0000000' || (n % 10)::text);
    assert result ->> 'result' = 'invalid_code', format('bad code %s: %s', n, result);
  end loop;
  result := public.member_door_check_in('LG1.1.' || c_cur);
  assert result ->> 'result' = 'rate_limited', format('the 11th attempt: %s', result);
  execute 'reset role';
  select count(*) into n from public.attendance a where a.member_id = m_thr;
  assert n = 0, 'a throttled member got in';
  -- failures age out after 10 minutes
  update public.door_qr_failures set failed_at = now() - interval '11 minutes' where member_id = m_thr;
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m_thr::text, 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';
  result := public.member_door_check_in('LG1.1.' || c_cur);
  assert result ->> 'result' = 'ok', format('after the window passed: %s', result);

  -- 11. staff / anon callers ------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin
    perform public.member_door_check_in('LG1.1.' || c_cur);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a staff member (no member_id) scanned the door code';

  -- 12. rfid_qr_config -------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  execute 'set local role service_role';
  result := public.rfid_qr_config(hash_a2);
  assert result ->> 'decision' = 'ok' and (result #>> '{qr,qr_id}')::int = 2
     and decode(result #>> '{qr,secret_b64}', 'base64') = sec_a2
     and (result ->> 'server_time')::bigint > 1700000000,
    format('rfid_qr_config: %s', result);
  result := public.rfid_qr_config('nope');
  assert result ->> 'reason' = 'device_unknown', 'rfid_qr_config with an unknown key';

  -- 13. rotate_device_key rotates the QR secret too ---------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  result := public.rotate_device_key(dev_a2);
  assert result ->> 'key' is not null, 'rotate_device_key returned no key';
  execute 'reset role';
  assert (select s.qr_secret from public.device_qr_secrets s where s.device_id = dev_a2) <> sec_a2,
    'rotate_device_key kept the old QR secret';
  w := floor(extract(epoch from now()) / 30);
  c_cur := public.door_qr_code(sec_a2, 2, w);   -- the OLD secret's code
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m_bad::text, 'branch_ids', json_build_array(br_a1)
  )::text, true);
  execute 'set local role authenticated';
  result := public.member_door_check_in('LG1.2.' || c_cur);
  assert result ->> 'result' = 'invalid_code', 'a code from the rotated-out secret still works';

  -- teardown -----------------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'door qr: all assertions passed';
end $$;
