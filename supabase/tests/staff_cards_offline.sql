-- Staff cards, Phase 3: the offline half. What a reader caches (staff cards as
-- status 'S', in the same global card_uid order as member cards, only for staff
-- who may enter at that door) and how the taps it decided offline are replayed
-- (staff taps become clock-ins/outs stamped with the TAP time, oldest first,
-- never in members' `attendance`, never in the enrollment inbox).
--
-- Seeds one org, calls the (security definer) RPCs directly, asserts the grants
-- keep everyone but service_role out, then removes its fixtures. A failed
-- assertion aborts.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/staff_cards_offline.sql

do $$
declare
  org_a uuid := 'f5f5f5f5-5555-5555-5555-555555555555';
  br_a1 uuid := 'f5b00000-0000-0000-0000-000000000001';
  br_a2 uuid := 'f5b00000-0000-0000-0000-000000000002';
  st_owner uuid := 'f5000000-0000-0000-0000-00000000000f';
  st_tr1   uuid := 'f5000000-0000-0000-0000-000000000011';
  st_tr2   uuid := 'f5000000-0000-0000-0000-000000000012';
  st_gone  uuid := 'f5000000-0000-0000-0000-000000000014';

  plan_month uuid;
  m1 uuid;
  m2 uuid;
  dev_a1 uuid;
  dev_a2 uuid;
  hash_a1 text := encode(extensions.digest('lgd_test_staffoff_a1', 'sha256'), 'hex');
  hash_a2 text := encode(extensions.digest('lgd_test_staffoff_a2', 'sha256'), 'hex');

  today_a date;
  result jsonb;
  tap jsonb;
  line text;
  uids text[];
  all_uids text[];
  after_uid text;
  pages integer;
  n integer;
  shift public.staff_attendance%rowtype;
  t0 timestamptz := date_trunc('second', now() - interval '3 hours');
  t1 timestamptz := date_trunc('second', now() - interval '2 hours');
  t2 timestamptz := date_trunc('second', now() - interval '1 hour');
begin
  -- fixtures ---------------------------------------------------------------------
  insert into public.orgs (id, name, slug) values (org_a, 'Phi Fitness', 'phi-fitness-test');
  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Phi One'), (br_a2, org_a, 'Phi Two');
  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_owner, org_a, 'Phi Owner',   'owner@phi.test', 'owner',   '{}',         'active'),
    (st_tr1,   org_a, 'Phi Trainer', 'tr1@phi.test',   'trainer', array[br_a1], 'active'),
    (st_tr2,   org_a, 'Phi Other',   'tr2@phi.test',   'trainer', array[br_a2], 'active'),
    (st_gone,  org_a, 'Phi Left',    'gone@phi.test',  'trainer', array[br_a1], 'active');

  today_a := public.org_today(org_a);
  insert into public.membership_plans (org_id, name, plan_type, duration_days, price_paisa)
  values (org_a, 'Monthly', 'time', 30, 250000) returning id into plan_month;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by) values
    (org_a, br_a1, 'Phi Member One', '9840000001', st_owner) returning id into m1;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by) values
    (org_a, br_a1, 'Phi Member Two', '9840000002', st_owner) returning id into m2;
  insert into public.memberships
    (org_id, branch_id, member_id, plan_id, plan_name, plan_type,
     start_date, end_date, price_paisa, status)
  select org_a, br_a1, mid, plan_month, 'Monthly', 'time',
         today_a - 5, today_a + 25, 250000, 'active'
  from unnest(array[m1, m2]) as mid;

  insert into public.devices (org_id, branch_id, name, key_hash, key_prefix, status) values
    (org_a, br_a1, 'Phi Door One', hash_a1, 'lgd_test', 'active'),
    (org_a, br_a2, 'Phi Door Two', hash_a2, 'lgd_test', 'active');
  select id into dev_a1 from public.devices where key_hash = hash_a1;
  select id into dev_a2 from public.devices where key_hash = hash_a2;

  -- UIDs interleave on purpose: the staff lines must slot between member lines.
  insert into public.member_cards (org_id, member_id, card_uid) values
    (org_a, m1, '04B00001'),
    (org_a, m2, '04B00009');
  insert into public.staff_cards (org_id, staff_id, card_uid) values
    (org_a, st_tr1,   '04B00005'),
    (org_a, st_tr2,   '04B00006'),
    (org_a, st_owner, '04B00007'),
    (org_a, st_gone,  '04B00008');
  update public.staff set status = 'inactive' where id = st_gone;

  -- sync: who gets a line ---------------------------------------------------------
  result := public.rfid_sync_cards(hash_a1);
  assert result ->> 'decision' = 'ok', 'sync was refused';
  select array_agg(c ->> 0 order by ord) into uids
  from jsonb_array_elements(result -> 'cards') with ordinality as t(c, ord);
  assert uids = array['04B00001','04B00005','04B00007','04B00009'],
    'door one should list both members plus the branch trainer and the owner, in card_uid order, got ' || coalesce(uids::text, 'null');

  select c into tap from jsonb_array_elements(result -> 'cards') as t(c) where c ->> 0 = '04B00005';
  assert tap ->> 2 = 'S', 'a staff card was not sent with status S';
  assert tap ->> 1 = '20991231', 'a staff card should carry the open-ended date';
  assert tap ->> 3 = 'Phi Trainer', 'a staff card should carry the holder''s name, got ' || coalesce(tap ->> 3, 'null');
  select c into tap from jsonb_array_elements(result -> 'cards') as t(c) where c ->> 0 = '04B00001';
  assert tap ->> 2 = 'A', 'a member card changed shape';
  assert tap ->> 3 = 'Phi Member One', 'a member card should carry the holder''s name, got ' || coalesce(tap ->> 3, 'null');

  result := public.rfid_sync_cards(hash_a2);
  select array_agg(c ->> 0 order by ord) into uids
  from jsonb_array_elements(result -> 'cards') with ordinality as t(c, ord);
  assert uids = array['04B00001','04B00006','04B00007','04B00009'],
    'door two should list the other branch''s trainer and the owner, not door one''s trainer, got ' || coalesce(uids::text, 'null');

  -- paging: two cards a page must give the same list, in the same order ------------
  all_uids := '{}';
  after_uid := null;
  pages := 0;
  loop
    result := public.rfid_sync_cards(hash_a1, after_uid, 2);
    pages := pages + 1;
    select coalesce(array_agg(c ->> 0 order by ord), '{}') into uids
    from jsonb_array_elements(result -> 'cards') with ordinality as t(c, ord);
    all_uids := all_uids || uids;
    exit when not (result ->> 'more')::boolean;
    after_uid := result ->> 'last_uid';
    assert pages < 10, 'paging did not terminate';
  end loop;
  assert pages = 2, 'four cards at two a page should be two pages, got ' || pages;
  assert all_uids = array['04B00001','04B00005','04B00007','04B00009'],
    'paged sync lost or reordered cards: ' || all_uids::text;

  -- replay: tap time, order, sources ---------------------------------------------------
  -- Sent newest first on purpose: the server must replay oldest first.
  result := public.rfid_log_offline(hash_a1, jsonb_build_array(
    jsonb_build_object('uid', '04B00005', 'ts', to_char(t1 at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    jsonb_build_object('uid', '04B00005', 'ts', to_char(t0 at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  ));
  assert result ->> 'decision' = 'ok', 'replay was refused';
  assert (result ->> 'staff_clocked')::int = 2, 'both staff taps should clock, got ' || result::text;
  assert (result ->> 'unknown')::int = 0, 'a known staff card was counted unknown';

  select * into shift from public.staff_attendance where staff_id = st_tr1;
  assert shift.clocked_in_at = t0, 'the clock-in is not stamped with the tap time';
  assert shift.clocked_out_at = t1, 'the clock-out is not stamped with the tap time';
  assert shift.in_source = 'offline_card' and shift.out_source = 'offline_card',
    'replayed shifts should have source offline_card';
  assert shift.device_id = dev_a1 and shift.branch_id = br_a1, 'the shift lost its door';

  select count(*) into n from public.attendance where member_id in (m1, m2);
  assert n = 0, 'a staff tap leaked into member attendance';
  select count(*) into n from public.unassigned_card_scans where card_uid = '04B00005';
  assert n = 0, 'a staff tap landed in the enrollment inbox';

  -- replaying the same batch again (lost reply) changes nothing
  result := public.rfid_log_offline(hash_a1, jsonb_build_array(
    jsonb_build_object('uid', '04B00005', 'ts', to_char(t0 at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    jsonb_build_object('uid', '04B00005', 'ts', to_char(t1 at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  ));
  assert (result ->> 'staff_clocked')::int = 0 and (result ->> 'duplicate')::int = 2,
    'a re-uploaded batch should be all duplicates, got ' || result::text;
  select count(*) into n from public.staff_attendance where staff_id = st_tr1;
  assert n = 1, 'a re-uploaded batch made extra shifts';

  -- an online tap recorded after the outage wins over an older offline tap
  tap := public.staff_clock_tap(org_a, br_a1, dev_a1, st_tr1);  -- the old 5-arg call still works
  assert tap ->> 'clock' = 'in', 'the online 5-arg staff_clock_tap call broke';
  result := public.rfid_log_offline(hash_a1, jsonb_build_array(
    jsonb_build_object('uid', '04B00005', 'ts', to_char(t2 at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  ));
  assert (result ->> 'staff_clocked')::int = 0 and (result ->> 'duplicate')::int = 1,
    'an offline tap older than a recorded one should be dropped, got ' || result::text;
  select count(*) into n from public.staff_attendance where staff_id = st_tr1;
  assert n = 2, 'the stale offline tap changed the shifts';

  -- a door double-tap offline is one clock-in, not in then out
  result := public.rfid_log_offline(hash_a2, jsonb_build_array(
    jsonb_build_object('uid', '04B00006', 'ts', to_char(t0 at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    jsonb_build_object('uid', '04B00006', 'ts', to_char((t0 + interval '1 minute') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  ));
  assert (result ->> 'staff_clocked')::int = 1 and (result ->> 'duplicate')::int = 1,
    'an offline double-tap should clock in once, got ' || result::text;
  select * into shift from public.staff_attendance where staff_id = st_tr2;
  assert shift.clocked_out_at is null, 'an offline double-tap clocked the person out';

  -- people who may not enter are not clocked in, and are not strangers either
  result := public.rfid_log_offline(hash_a1, jsonb_build_array(
    jsonb_build_object('uid', '04B00008', 'ts', to_char(t0 at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    jsonb_build_object('uid', '04B00006', 'ts', to_char(t1 at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  ));
  assert (result ->> 'staff_clocked')::int = 0 and (result ->> 'unknown')::int = 2,
    'a deactivated or wrong-branch staff tap should be refused, got ' || result::text;
  select count(*) into n from public.staff_attendance where staff_id = st_gone;
  assert n = 0, 'a deactivated staff member was clocked in';
  select count(*) into n from public.unassigned_card_scans where card_uid in ('04B00008', '04B00006');
  assert n = 0, 'a known staff card went to the enrollment inbox';

  -- a member in the same batch is unchanged
  result := public.rfid_log_offline(hash_a1, jsonb_build_array(
    jsonb_build_object('uid', '04B00001', 'ts', to_char(t1 at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  ));
  assert (result ->> 'accepted')::int = 1, 'a member tap stopped being accepted, got ' || result::text;
  select count(*) into n from public.attendance where member_id = m1 and checked_in_at = t1;
  assert n = 1, 'the member visit was not stamped with the tap time';

  -- grants: only the service role may call any of it ---------------------------------
  assert not has_function_privilege('anon', 'public.staff_clock_tap(uuid,uuid,uuid,uuid,text,timestamptz)', 'execute'),
    'anon can execute staff_clock_tap';
  assert not has_function_privilege('authenticated', 'public.staff_clock_tap(uuid,uuid,uuid,uuid,text,timestamptz)', 'execute'),
    'authenticated can execute staff_clock_tap';
  assert not has_function_privilege('authenticated', 'public.rfid_sync_cards(text,text,integer)', 'execute'),
    'authenticated can execute rfid_sync_cards';
  assert not has_function_privilege('authenticated', 'public.rfid_log_offline(text,jsonb)', 'execute'),
    'authenticated can execute rfid_log_offline';

  -- teardown -------------------------------------------------------------------------
  delete from public.orgs where id = org_a;

  raise notice 'staff cards offline: all assertions passed';
end $$;
