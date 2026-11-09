-- Member app PIN login: verify_member_pin, member_login_lookup, the desk's
-- set/clear/status RPCs, and the member's my_card / request_renewal / own-only
-- attendance_snapshot. Seeds two orgs, drives the real functions as real roles,
-- asserts, then removes its fixtures. A failed assertion aborts.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/member_pin_login.sql

do $$
declare
  org_a uuid := 'd7d7d7d7-1111-1111-1111-111111111111';
  org_b uuid := 'd8d8d8d8-2222-2222-2222-222222222222';
  br_a1 uuid := 'd7b00000-0000-0000-0000-000000000001';
  br_a2 uuid := 'd7b00000-0000-0000-0000-000000000002';
  br_b1 uuid := 'd8b00000-0000-0000-0000-000000000001';
  st_owner uuid := 'd7000000-0000-0000-0000-00000000000f';
  st_desk  uuid := 'd7000000-0000-0000-0000-00000000000d';
  st_desk2 uuid := 'd7000000-0000-0000-0000-00000000000e';
  st_tr    uuid := 'd7000000-0000-0000-0000-000000000011';
  st_b_owner uuid := 'd8000000-0000-0000-0000-00000000000f';

  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid; m6 uuid; mb uuid;
  r jsonb;
  got uuid;
  n integer;
  failed boolean;
  hash0 text;
  st_id uuid;
  gen_pin text;
  u_staff uuid := 'd7a00000-0000-0000-0000-0000000000a1';
begin
  -- fixtures (owner role) -------------------------------------------------------
  insert into public.orgs (id, name, slug) values
    (org_a, 'Omicron Fitness', 'omicron-pin-test'),
    (org_b, 'Pi Gyms', 'pi-pin-test');
  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Omicron One'), (br_a2, org_a, 'Omicron Two'), (br_b1, org_b, 'Pi One');
  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_owner, org_a, 'O Owner', 'owner@omicron.test', 'owner', '{}', 'active'),
    (st_desk,  org_a, 'O Desk',  'desk@omicron.test',  'front_desk', array[br_a1], 'active'),
    (st_desk2, org_a, 'O Desk2', 'desk2@omicron.test', 'front_desk', array[br_a2], 'active'),
    (st_tr,    org_a, 'O Trainer', 'tr@omicron.test',  'trainer', array[br_a1], 'active'),
    (st_b_owner, org_b, 'P Owner', 'owner@pi.test', 'owner', '{}', 'active');

  insert into public.members (org_id, home_branch_id, full_name, phone) values (org_a, br_a1, 'Pin One', '+977 9841000001') returning id into m1;
  insert into public.members (org_id, home_branch_id, full_name, phone) values (org_a, br_a1, 'Pin Two', '9841000002') returning id into m2;
  insert into public.members (org_id, home_branch_id, full_name, phone) values (org_a, br_a1, 'Pin Three', '9841000003') returning id into m3;
  insert into public.members (org_id, home_branch_id, full_name, phone) values (org_a, br_a1, 'Pin Four', '9841000004') returning id into m4;
  insert into public.members (org_id, home_branch_id, full_name, phone) values (org_a, br_a1, 'Pin Five', '9841000005') returning id into m5;
  -- same digits as m1 once formatting is stripped -> ambiguous phone
  insert into public.members (org_id, home_branch_id, full_name, phone) values (org_a, br_a1, 'Pin Dupe', '9841-000001') returning id into m6;
  insert into public.members (org_id, home_branch_id, full_name, phone) values (org_b, br_b1, 'Other Org', '9841000001') returning id into mb;

  -- cards: 0001 -> m1, 0002 -> m2, 0003 unassigned, 0004 -> m4 (will be archived),
  -- 0005 -> m5 (will be revoked then reissued to m3). Org B also has a card 0001.
  insert into public.card_stock (org_id, card_no, card_uid, status) values
    (org_a, 1, 'AA000001', 'free'), (org_a, 2, 'AA000002', 'free'), (org_a, 3, null, 'free'),
    (org_a, 4, 'AA000004', 'free'), (org_a, 5, 'AA000005', 'free'),
    (org_b, 1, 'BB000001', 'free');
  insert into public.member_cards (org_id, member_id, card_uid) values
    (org_a, m1, 'AA000001'), (org_a, m2, 'AA000002'), (org_a, m4, 'AA000004'), (org_a, m5, 'AA000005'),
    (org_b, mb, 'BB000001');

  -- verify_member_pin (service role) ---------------------------------------------
  insert into public.member_pins (member_id, org_id, pin_hash)
  values (m1, org_a, extensions.crypt('4821', extensions.gen_salt('bf', 8))),
         (m2, org_a, extensions.crypt('1234', extensions.gen_salt('bf', 8)));
  execute 'set local role service_role';

  r := public.verify_member_pin(m1, '4821');
  assert r = '{"result":"ok"}'::jsonb, format('right pin: %s', r);
  r := public.verify_member_pin(m1, '0000');
  assert r = '{"result":"invalid"}'::jsonb, format('wrong pin: %s', r);
  r := public.verify_member_pin(m3, '4821');
  assert r = '{"result":"invalid"}'::jsonb, 'member with no pin row must look like a wrong pin';
  r := public.verify_member_pin(gen_random_uuid(), '4821');
  assert r = '{"result":"invalid"}'::jsonb, 'unknown member must look like a wrong pin';

  -- lockout: 4 fails then the 5th locks; success earlier reset the count
  perform public.verify_member_pin(m1, '1');
  perform public.verify_member_pin(m1, '1');
  perform public.verify_member_pin(m1, '1');
  r := public.verify_member_pin(m1, '4821');          -- success resets the streak
  assert r ->> 'result' = 'ok', 'success mid-streak';
  perform public.verify_member_pin(m1, '1');
  perform public.verify_member_pin(m1, '1');
  perform public.verify_member_pin(m1, '1');
  r := public.verify_member_pin(m1, '1');
  assert r ->> 'result' = 'invalid', format('4th consecutive failure is not yet a lock: %s', r);
  r := public.verify_member_pin(m1, '1');
  assert r ->> 'result' = 'locked' and (r ->> 'retry_after_seconds')::integer between 890 and 900,
    format('5th failure locks: %s', r);
  r := public.verify_member_pin(m1, '4821');
  assert r ->> 'result' = 'locked', 'right pin while locked is still locked';
  execute 'reset role';
  update public.member_pins set locked_until = now() - interval '1 second' where member_id = m1;
  execute 'set local role service_role';
  r := public.verify_member_pin(m1, '4821');
  assert r ->> 'result' = 'ok', format('after the lock expires: %s', r);
  select count(*) into n from public.member_pins where member_id = m1 and failed_attempts = 0 and locked_until is null;
  assert n = 1, 'success clears failed_attempts and locked_until';

  -- escalating lockout: first lock 900s, second 1800s, a success resets the level
  select count(*) into n from public.member_pins where member_id = m1 and lock_level = 0;
  assert n = 1, 'success resets lock_level';
  for i in 1..4 loop perform public.verify_member_pin(m1, '1'); end loop;
  r := public.verify_member_pin(m1, '1');
  assert r ->> 'result' = 'locked' and (r ->> 'retry_after_seconds')::integer = 900, format('first lock is 900s: %s', r);
  execute 'reset role';
  update public.member_pins set locked_until = now() - interval '1 second' where member_id = m1;
  execute 'set local role service_role';
  for i in 1..4 loop
    r := public.verify_member_pin(m1, '1');
    assert r ->> 'result' = 'invalid', format('fresh streak after a lock expires: %s', r);
  end loop;
  r := public.verify_member_pin(m1, '1');
  assert r ->> 'result' = 'locked' and (r ->> 'retry_after_seconds')::integer = 1800, format('second lock is 1800s: %s', r);
  execute 'reset role';
  select count(*) into n from public.member_pins where member_id = m1 and lock_level = 2 and failed_attempts = 0;
  assert n = 1, 'lock_level is 2 after two locks';
  update public.member_pins set locked_until = now() - interval '1 second', lock_level = 9 where member_id = m1;
  execute 'set local role service_role';
  for i in 1..4 loop perform public.verify_member_pin(m1, '1'); end loop;
  r := public.verify_member_pin(m1, '1');
  assert (r ->> 'retry_after_seconds')::integer = 900 * 64, format('lock length is capped at 2^6: %s', r);
  execute 'reset role';
  update public.member_pins set locked_until = now() - interval '1 second' where member_id = m1;
  execute 'set local role service_role';
  r := public.verify_member_pin(m1, '4821');
  assert r ->> 'result' = 'ok', 'right pin after the lock';
  execute 'reset role';
  select count(*) into n from public.member_pins where member_id = m1 and lock_level = 0 and failed_attempts = 0;
  assert n = 1, 'success resets lock_level and failed_attempts';
  execute 'set local role service_role';

  -- member_login_lookup ----------------------------------------------------------
  assert public.member_login_lookup('omicron-pin-test', '0001') = m1, 'card 0001 -> m1';
  assert public.member_login_lookup('omicron-pin-test', 'NO. 2') = m2, 'card "NO. 2" -> m2';
  assert public.member_login_lookup('omicron-pin-test', '0003') is null, 'unassigned card';
  assert public.member_login_lookup('omicron-pin-test', '0099') is null, 'unknown card';
  assert public.member_login_lookup('omicron-pin-test', '0000') is null, 'card zero';
  assert public.member_login_lookup('no-such-gym', '0001') is null, 'unknown org';
  assert public.member_login_lookup('pi-pin-test', '0001') = mb, 'cross-org: org B card 0001 is org B''s member';
  assert public.member_login_lookup('omicron-pin-test', '98410000') is null, '8 digits matching nothing';
  -- phone
  assert public.member_login_lookup('omicron-pin-test', '9841000002') = m2, 'phone exact';
  assert public.member_login_lookup('omicron-pin-test', '984-1000002') = m2, 'phone with punctuation';
  assert public.member_login_lookup('omicron-pin-test', '9779841000002') = m2, 'phone with country code on the input';
  assert public.member_login_lookup('omicron-pin-test', '9841000003') = m3, 'phone m3';
  assert public.member_login_lookup('omicron-pin-test', '9841000001') is null, 'ambiguous phone (m1 and m6) -> null';
  assert public.member_login_lookup('pi-pin-test', '9841000001') = mb, 'phone is scoped to the org';
  -- length disambiguation
  assert public.member_login_lookup('omicron-pin-test', '12345') is null, '5 digits -> null';
  assert public.member_login_lookup('omicron-pin-test', '123456') is null, '6 digits -> null';
  assert public.member_login_lookup('omicron-pin-test', '') is null, 'empty';
  assert public.member_login_lookup('omicron-pin-test', 'abc') is null, 'letters';
  assert public.member_login_lookup('omicron-pin-test', '1234567890123456') is null, '16 digits';
  -- the number "0002" must never be treated as a phone, nor a phone as a card
  assert public.member_login_lookup('omicron-pin-test', '9841') is null, '4 digits is a card number, not a phone prefix';

  -- archived / left / reissued
  execute 'reset role';
  update public.members set archived_at = now(), archived_reason = 'test' where id = m4;
  update public.members set archived_at = now(), archived_reason = 'test' where id = m5;
  execute 'set local role service_role';
  assert public.member_login_lookup('omicron-pin-test', '0004') is null, 'archived member via card';
  assert public.member_login_lookup('omicron-pin-test', '9841000004') is null, 'archived member via phone';
  execute 'reset role';
  update public.members set archived_at = null, archived_reason = null where id = m5;
  update public.member_cards set revoked_at = now(), revoke_reason = 'test' where member_id = m5;
  insert into public.member_cards (org_id, member_id, card_uid) values (org_a, m3, 'AA000005');
  execute 'set local role service_role';
  assert public.member_login_lookup('omicron-pin-test', '0005') = m3, 'reissued card belongs to the new holder';
  execute 'reset role';
  update public.member_cards set revoked_at = now(), revoke_reason = 'test' where member_id = m3;
  execute 'set local role service_role';
  assert public.member_login_lookup('omicron-pin-test', '0005') is null, 'revoked card';

  -- privilege checks ---------------------------------------------------------------
  execute 'reset role';
  assert not has_function_privilege('anon', 'public.verify_member_pin(uuid,text)', 'execute'), 'anon verify';
  assert not has_function_privilege('authenticated', 'public.verify_member_pin(uuid,text)', 'execute'), 'authenticated verify';
  assert not has_function_privilege('anon', 'public.member_login_lookup(text,text)', 'execute'), 'anon lookup';
  assert not has_function_privilege('authenticated', 'public.member_login_lookup(text,text)', 'execute'), 'authenticated lookup';
  assert has_function_privilege('service_role', 'public.verify_member_pin(uuid,text)', 'execute'), 'service verify';
  assert not has_function_privilege('anon', 'public.set_member_pin(uuid,text)', 'execute'), 'anon set_member_pin';
  assert not has_function_privilege('anon', 'public.my_card()', 'execute'), 'anon my_card';
  assert not has_table_privilege('authenticated', 'public.member_pins', 'select'), 'authenticated reads member_pins';
  assert not has_table_privilege('anon', 'public.member_pins', 'select'), 'anon reads member_pins';
  failed := false;
  begin
    execute 'set local role authenticated';
    perform public.verify_member_pin(m1, '4821');
  exception when insufficient_privilege then failed := true;
  end;
  execute 'reset role';
  assert failed, 'a signed-in user called verify_member_pin';

  -- desk RPCs -------------------------------------------------------------------------
  -- trainer: no
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_tr::text, 'staff_role', 'trainer', 'branch_ids', json_build_array(br_a1))::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin perform public.set_member_pin(m3, '5555'); exception when insufficient_privilege then failed := true; end;
  assert failed, 'a trainer set a member pin';

  -- desk (branch 1)
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text, 'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1))::text, true);
  r := public.member_pin_status(m3);
  assert (r ->> 'has_pin')::boolean = false and r -> 'locked_until' = 'null'::jsonb, format('status no pin: %s', r);
  r := public.set_member_pin(m3, '5555');
  assert r = '{"result":"ok"}'::jsonb, format('desk sets a given pin: %s', r);
  r := public.set_member_pin(m3);
  assert r ->> 'result' = 'ok' and (r ->> 'pin') ~ '^[0-9]{6}$', format('generated pin: %s', r);
  gen_pin := r ->> 'pin';
  r := public.member_pin_status(m3);
  assert (r ->> 'has_pin')::boolean, 'status has pin';
  foreach hash0 in array array['', 'abc', '123', '1234567', '12 34', '12a45'] loop
    failed := false;
    begin perform public.set_member_pin(m3, hash0); exception when check_violation then failed := true; end;
    assert failed, format('pin "%s" accepted', hash0);
  end loop;

  -- reset clears the lock
  execute 'reset role';
  update public.member_pins set failed_attempts = 3, locked_until = now() + interval '10 minutes' where member_id = m3;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text, 'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1))::text, true);
  execute 'set local role authenticated';
  assert (public.member_pin_status(m3) ->> 'locked_until') is not null, 'status shows the lock';
  perform public.set_member_pin(m3, '6666');
  assert (public.member_pin_status(m3) -> 'locked_until') = 'null'::jsonb, 'set clears the lock';

  -- scoping: desk of branch 2, other org's owner
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk2::text, 'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a2))::text, true);
  failed := false;
  begin perform public.set_member_pin(m3, '7777'); exception when no_data_found then failed := true; end;
  assert failed, 'a desk at another branch set a pin';
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_owner::text, 'staff_role', 'owner', 'branch_ids', json_build_array())::text, true);
  failed := false;
  begin perform public.set_member_pin(m3, '7777'); exception when no_data_found then failed := true; end;
  assert failed, 'another org''s owner set a pin';
  failed := false;
  begin perform public.member_pin_status(m3); exception when no_data_found then failed := true; end;
  assert failed, 'another org''s owner read pin status';
  failed := false;
  begin perform public.clear_member_pin(m3); exception when no_data_found then failed := true; end;
  assert failed, 'another org''s owner cleared a pin';

  -- owner clears
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text, 'staff_role', 'owner', 'branch_ids', json_build_array())::text, true);
  r := public.clear_member_pin(m3);
  assert r ->> 'result' = 'ok' and (r ->> 'had_pin')::boolean, format('owner clears: %s', r);
  assert not (public.member_pin_status(m3) ->> 'has_pin')::boolean, 'cleared';

  -- member principal: my_card / request_renewal / own-only snapshot / no desk RPCs
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m1::text, 'branch_ids', json_build_array(br_a1))::text, true);
  r := public.my_card();
  assert (r ->> 'card_no')::integer = 1 and r ->> 'card_no_text' = '0001' and r ->> 'assigned_at' is not null,
    format('my_card: %s', r);
  failed := false;
  begin perform public.set_member_pin(m1, '1111'); exception when insufficient_privilege then failed := true; end;
  assert failed, 'a member set a pin';
  failed := false;
  begin perform public.member_pin_status(m1); exception when insufficient_privilege then failed := true; end;
  assert failed, 'a member read pin status';
  select count(*) into n from public.attendance_snapshot(m1);
  assert n = 1, 'a member reads their own snapshot';
  select count(*) into n from public.attendance_snapshot(m2);
  assert n = 0, 'a member read another member''s snapshot';
  select count(*) into n from public.attendance_snapshot(mb);
  assert n = 0, 'a member read another org''s snapshot';
  r := public.request_renewal('9841000001', 'please');
  assert r = '{"result":"ok"}'::jsonb, format('request_renewal: %s', r);
  r := public.request_renewal();
  assert r = '{"result":"too_soon"}'::jsonb, format('repeat: %s', r);
  execute 'reset role';
  select count(*), max(card_stock_id::text) into n, hash0 from public.renewal_requests where member_id = m1 and status = 'pending';
  assert n = 1 and hash0 is not null, 'one pending request with the card attached';

  -- member without a card: still allowed, and my_card is all null
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', m2::text, 'branch_ids', json_build_array(br_a1))::text, true);
  update public.member_cards set revoked_at = now(), revoke_reason = 'test' where member_id = m2;
  execute 'set local role authenticated';
  r := public.my_card();
  assert r = '{"card_no":null,"card_no_text":null,"assigned_at":null}'::jsonb, format('no card: %s', r);
  r := public.request_renewal();
  assert r ->> 'result' = 'ok', format('renewal without a card: %s', r);

  -- not a member
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text, 'staff_role', 'owner', 'branch_ids', json_build_array())::text, true);
  failed := false;
  begin perform public.my_card(); exception when insufficient_privilege then failed := true; end;
  assert failed, 'staff called my_card';

  -- set_member_pin resets the escalation; refuses a member whose account is a staff login
  execute 'reset role';
  update public.member_pins set failed_attempts = 3, lock_level = 4, locked_until = now() + interval '1 hour'
  where member_id = m1;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text, 'staff_role', 'owner', 'branch_ids', json_build_array())::text, true);
  execute 'set local role authenticated';
  perform public.set_member_pin(m1, '4822');
  execute 'reset role';
  select count(*) into n from public.member_pins
  where member_id = m1 and lock_level = 0 and failed_attempts = 0 and locked_until is null;
  assert n = 1, 'set_member_pin resets lock_level, failed_attempts and the lock';

  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values (u_staff, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'staffmember@omicron.test', now(), now(), now());
  update public.staff set auth_user_id = u_staff where id = st_desk;
  update public.members set auth_user_id = u_staff where id = m2;
  execute 'set local role authenticated';
  failed := false;
  begin perform public.set_member_pin(m2, '4823'); exception when insufficient_privilege then failed := true; end;
  assert failed, 'a PIN was set for a member whose account is a staff login';
  execute 'reset role';
  update public.members set auth_user_id = null where id = m2;
  update public.staff set auth_user_id = null where id = st_desk;
  delete from auth.users where id = u_staff;
  perform set_config('request.jwt.claims', null, true);

  -- audit: the pin and its hash never reach audit_log -----------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  select count(*) into n from public.audit_log where org_id = org_a and entity = 'member_pins';
  assert n >= 4, format('set/clear should leave audit entries, found %s', n);
  select count(*) into n from public.audit_log
  where org_id = org_a
    and ((coalesce(before::text, '') || coalesce(after::text, '')) ~ '(pin_hash|\$2[aby]\$)'
         or (entity = 'member_pins'
             and (coalesce(before::text, '') || coalesce(after::text, '')) ~ ('(5555|6666|' || gen_pin || ')')));
  assert n = 0, 'a pin or hash leaked into audit_log';
  select count(*) into n from pg_trigger where tgrelid = 'public.member_pins'::regclass and not tgisinternal;
  assert n = 0, 'member_pins must not carry the generic audit trigger';

  -- teardown ----------------------------------------------------------------------------
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'member pin login: all assertions passed';
end $$;
