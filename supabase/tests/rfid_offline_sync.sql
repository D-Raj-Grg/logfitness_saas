-- RFID offline gate: the allow-list the reader caches (rfid_sync_cards) and the
-- backfill of taps it decided offline (rfid_log_offline).
--
-- Seeds two orgs, drives both RPCs as `service_role` with no JWT claims -- the
-- Edge Function's position -- asserts the allow rule matches rfid_check_in,
-- tenant isolation, paging, idempotent replay and grant hygiene, times a full
-- sync of 5,000 members, then removes its fixtures. A failed assertion aborts.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rfid_offline_sync.sql

do $$
declare
  org_a uuid := 'f3f3f3f3-3333-3333-3333-333333333333';
  org_b uuid := 'f4f4f4f4-4444-4444-4444-444444444444';
  br_a1 uuid := 'f3b00000-0000-0000-0000-000000000001';
  br_b1 uuid := 'f4b00000-0000-0000-0000-000000000001';
  st_a_owner uuid := 'f3000000-0000-0000-0000-00000000000f';
  st_b_owner uuid := 'f4000000-0000-0000-0000-00000000000f';

  plan_month uuid;
  plan_b uuid;
  m_ok uuid;
  m_expiring uuid;
  m_due uuid;
  m_expired uuid;
  m_frozen uuid;
  m_none uuid;
  m_left uuid;
  m_left_due uuid;
  m_revoked uuid;
  m_b uuid;

  dev_a uuid;
  dev_off uuid;
  dev_b uuid;
  hash_a text := encode(extensions.digest('lgd_test_offline_a', 'sha256'), 'hex');
  hash_off text := encode(extensions.digest('lgd_test_offline_disabled', 'sha256'), 'hex');
  hash_b text := encode(extensions.digest('lgd_test_offline_b', 'sha256'), 'hex');

  today_a date;
  result jsonb;
  cards jsonb;
  after_uid text;
  pages integer;
  total integer;
  n integer;
  failed boolean;
  t0 timestamptz;
  ts_ok timestamptz := now() - interval '2 hours';
  v_att public.attendance%rowtype;
begin
  -- fixtures ---------------------------------------------------------------------
  insert into public.orgs (id, name, slug) values
    (org_a, 'Tau Fitness', 'tau-fitness-test'),
    (org_b, 'Upsilon Gyms', 'upsilon-gyms-test');
  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Tau Main'),
    (br_b1, org_b, 'Upsilon Main');
  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_a_owner, org_a, 'Tau Owner',     'owner@tau.test',     'owner', '{}', 'active'),
    (st_b_owner, org_b, 'Upsilon Owner', 'owner@upsilon.test', 'owner', '{}', 'active');

  today_a := public.org_today(org_a);

  insert into public.membership_plans (org_id, name, plan_type, duration_days, price_paisa)
  values (org_a, 'Monthly', 'time', 30, 250000) returning id into plan_month;
  insert into public.membership_plans (org_id, name, plan_type, duration_days, price_paisa)
  values (org_b, 'Monthly', 'time', 30, 200000) returning id into plan_b;

  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Ok Member',       '9830000001', st_a_owner) returning id into m_ok;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Expiring Member', '9830000002', st_a_owner) returning id into m_expiring;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Due Member',      '9830000003', st_a_owner) returning id into m_due;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Expired Member',  '9830000004', st_a_owner) returning id into m_expired;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Frozen Member',   '9830000005', st_a_owner) returning id into m_frozen;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Never Bought',    '9830000006', st_a_owner) returning id into m_none;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Left Member',     '9830000007', st_a_owner) returning id into m_left;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Revoked Member',  '9830000008', st_a_owner) returning id into m_revoked;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Left And Owing',  '9830000010', st_a_owner) returning id into m_left_due;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_b, br_b1, 'Upsilon Member',  '9830000009', st_b_owner) returning id into m_b;

  insert into public.memberships
    (org_id, branch_id, member_id, plan_id, plan_name, plan_type,
     start_date, end_date, price_paisa, status, frozen_on)
  values
    (org_a, br_a1, m_ok,       plan_month, 'Monthly', 'time', today_a - 5,  today_a + 25, 250000, 'active',  null),
    (org_a, br_a1, m_expiring, plan_month, 'Monthly', 'time', today_a - 27, today_a + 3,  250000, 'active',  null),
    (org_a, br_a1, m_expired,  plan_month, 'Monthly', 'time', today_a - 40, today_a - 10, 250000, 'expired', null),
    (org_a, br_a1, m_frozen,   plan_month, 'Monthly', 'time', today_a - 5,  today_a + 25, 250000, 'frozen',  today_a - 1),
    (org_a, br_a1, m_left,     plan_month, 'Monthly', 'time', today_a - 5,  today_a + 25, 250000, 'active',  null),
    (org_a, br_a1, m_revoked,  plan_month, 'Monthly', 'time', today_a - 5,  today_a + 25, 250000, 'active',  null),
    (org_b, br_b1, m_b,        plan_b,     'Monthly', 'time', today_a - 5,  today_a + 25, 200000, 'active',  null);

  -- m_due: sold a plan with nothing paid, as the owner would
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  perform public.renew_membership(m_due, plan_month, br_a1, today_a, 0, 0, 'cash');
  perform public.renew_membership(m_left_due, plan_month, br_a1, today_a, 0, 0, 'cash');
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  update public.members set archived_at = now() where id in (m_left, m_left_due);

  insert into public.devices (org_id, branch_id, name, key_hash, key_prefix, status) values
    (org_a, br_a1, 'Offline Front', hash_a,   'lgd_test', 'active'),
    (org_a, br_a1, 'Offline Off',   hash_off, 'lgd_test', 'disabled'),
    (org_b, br_b1, 'Offline B',     hash_b,   'lgd_test', 'active');
  select id into dev_a   from public.devices where key_hash = hash_a;
  select id into dev_off from public.devices where key_hash = hash_off;
  select id into dev_b   from public.devices where key_hash = hash_b;

  insert into public.member_cards (org_id, member_id, card_uid) values
    (org_a, m_ok,       '04A00001'),
    (org_a, m_expiring, '04A00002'),
    (org_a, m_due,      '04A00003'),
    (org_a, m_expired,  '04A00004'),
    (org_a, m_frozen,   '04A00005'),
    (org_a, m_left,     '04A00007'),
    (org_a, m_left_due, '04A00009'),
    (org_b, m_b,        '04B00001');
  -- a revoked card, and a live one for the same member afterwards
  insert into public.member_cards (org_id, member_id, card_uid, revoked_at, revoke_reason)
  values (org_a, m_revoked, '04A00008', now(), 'Lost');

  -- grants: only the Edge Function's role -----------------------------------------
  execute 'set local role anon';
  failed := false;
  begin
    perform public.rfid_sync_cards(hash_a);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'anon executed rfid_sync_cards';
  failed := false;
  begin
    perform public.rfid_log_offline(hash_a, '[]'::jsonb);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'anon executed rfid_log_offline';
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin
    perform public.rfid_sync_cards(hash_a);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a signed-in user executed rfid_sync_cards';
  failed := false;
  begin
    perform public.rfid_log_offline(hash_a, '[]'::jsonb);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a signed-in user executed rfid_log_offline';
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  -- from here on: the Edge Function's position ------------------------------------
  execute 'set local role service_role';

  -- device gating
  result := public.rfid_sync_cards('nope');
  assert result ->> 'reason' = 'device_unknown', format('unknown key: %s', result);
  result := public.rfid_sync_cards(hash_off);
  assert result ->> 'reason' = 'device_disabled', format('disabled reader: %s', result);
  result := public.rfid_log_offline('nope', '[]'::jsonb);
  assert result ->> 'reason' = 'device_unknown', format('unknown key (log): %s', result);
  result := public.rfid_log_offline(hash_off, '[]'::jsonb);
  assert result ->> 'reason' = 'device_disabled', format('disabled reader (log): %s', result);
  result := public.rfid_log_offline(hash_a, '{"uid":"x"}'::jsonb);
  assert result ->> 'reason' = 'bad_batch', 'a non-array batch was accepted';

  -- every live card is listed with the status rfid_check_in would give it
  result := public.rfid_sync_cards(hash_a);
  assert result ->> 'decision' = 'ok', format('sync refused: %s', result);
  assert (result ->> 'more')::boolean = false, 'a 7-card org needed a second page';
  assert result ->> 'org_today' = to_char(today_a, 'YYYYMMDD'), 'org_today is wrong';
  cards := result -> 'cards';
  assert jsonb_array_length(cards) = 7,
    format('expected the seven live cards (revoked one excluded), got %s', cards);
  assert cards -> 0 = jsonb_build_array('04A00001', to_char(today_a + 25, 'YYYYMMDD'), 'A'),
    format('ok member entry wrong: %s', cards -> 0);
  assert cards -> 1 = jsonb_build_array('04A00002', to_char(today_a + 3, 'YYYYMMDD'), 'A'),
    format('expiring member entry wrong: %s', cards -> 1);
  assert cards -> 2 = jsonb_build_array('04A00003', '00000000', 'D'),
    format('member owing money must be D: %s', cards -> 2);
  assert cards -> 3 = jsonb_build_array('04A00004', '00000000', 'E'),
    format('expired member must be E: %s', cards -> 3);
  assert cards -> 4 = jsonb_build_array('04A00005', '00000000', 'F'),
    format('frozen member must be F: %s', cards -> 4);
  assert cards -> 5 = jsonb_build_array('04A00007', '00000000', 'L'),
    format('archived member must be L: %s', cards -> 5);
  -- archived but still owing: rfid_check_in says dues, so the list must too
  assert cards -> 6 = jsonb_build_array('04A00009', '00000000', 'D'),
    format('archived member who owes money must be D: %s', cards -> 6);

  -- tenant isolation: org B's reader sees only org B's card
  result := public.rfid_sync_cards(hash_b);
  assert jsonb_array_length(result -> 'cards') = 1
     and result -> 'cards' -> 0 ->> 0 = '04B00001',
    format('org B''s reader saw %s', result -> 'cards');
  assert result -> 'cards' -> 0 ->> 2 = 'A', 'org B''s active member is not A';

  -- paging: limit 1 walks the whole candidate set, ok cards only
  after_uid := null;
  pages := 0;
  total := 0;
  loop
    result := public.rfid_sync_cards(hash_a, after_uid, 1);
    pages := pages + 1;
    total := total + jsonb_array_length(result -> 'cards');
    exit when not (result ->> 'more')::boolean;
    after_uid := result ->> 'last_uid';
    assert pages < 20, 'paging did not terminate';
  end loop;
  assert total = 7, format('paging found %s cards, expected 7', total);
  assert pages = 7, format('paging took %s pages, expected 7 (one per live card)', pages);

  -- backfill ---------------------------------------------------------------------
  result := public.rfid_log_offline(hash_a, jsonb_build_array(
    jsonb_build_object('uid', '04:A0:00:01', 'ts', ts_ok),
    jsonb_build_object('uid', '04A00001',    'ts', ts_ok + interval '1 minute'),
    jsonb_build_object('uid', 'DEADBEEF',    'ts', ts_ok),
    jsonb_build_object('uid', 'zz',          'ts', ts_ok),
    jsonb_build_object('uid', '04A00002',    'ts', now() + interval '2 hours'),
    jsonb_build_object('uid', '04B00001',    'ts', ts_ok)
  ));
  assert result ->> 'decision' = 'ok', format('backfill refused: %s', result);
  assert (result ->> 'accepted')::int = 2, format('accepted: %s', result);
  assert (result ->> 'duplicate')::int = 1, format('duplicate: %s', result);
  assert (result ->> 'unknown')::int = 2, format('unknown (stranger + other org''s card): %s', result);
  assert (result ->> 'clamped')::int = 1, format('clamped: %s', result);
  assert (result ->> 'bad_uid')::int = 1, format('bad_uid: %s', result);

  select * into v_att from public.attendance a
  where a.member_id = m_ok and a.org_id = org_a;
  assert v_att.checked_in_at = ts_ok, 'the visit was not backdated to the reader''s time';
  assert v_att.method = 'card'::public.attendance_method and v_att.device_id = dev_a
     and v_att.branch_id = br_a1 and v_att.checked_in_by is null,
    'the offline visit lost its device attribution';
  assert v_att.attended_on = (ts_ok at time zone 'Asia/Kathmandu')::date,
    'attended_on disagrees with checked_in_at';

  -- the snapshot is what the reader decided on, as of the tap -- not recomputed at upload
  assert v_att.due_paisa_at_checkin = 0
     and v_att.membership_status_at_checkin = 'active'::public.membership_status
     and v_att.days_to_expiry_at_checkin = (today_a + 25) - (ts_ok at time zone 'Asia/Kathmandu')::date,
    format('offline snapshot wrong: status %s days %s due %s', v_att.membership_status_at_checkin,
           v_att.days_to_expiry_at_checkin, v_att.due_paisa_at_checkin);

  select count(*) into n from public.attendance a where a.member_id = m_expiring;
  assert n = 1, 'a future-dated tap was dropped instead of clamped';

  select count(*) into n from public.unassigned_card_scans s
  where s.org_id = org_a and s.card_uid = 'DEADBEEF' and s.device_id = dev_a;
  assert n = 1, 'a stranger tapped offline did not reach the enrollment inbox';
  select count(*) into n from public.unassigned_card_scans s where s.card_uid = '04B00001' and s.org_id = org_b;
  assert n = 0, 'org A''s reader wrote into org B''s inbox';
  select count(*) into n from public.attendance a where a.org_id = org_b;
  assert n = 0, 'org A''s reader wrote a visit into org B';

  -- replaying the same batch changes nothing: every known tap is a duplicate
  result := public.rfid_log_offline(hash_a, jsonb_build_array(
    jsonb_build_object('uid', '04A00001', 'ts', ts_ok),
    jsonb_build_object('uid', '04A00002', 'ts', now())
  ));
  assert (result ->> 'accepted')::int = 0 and (result ->> 'duplicate')::int = 2,
    format('replay was not idempotent: %s', result);
  select count(*) into n from public.attendance a where a.org_id = org_a;
  assert n = 2, format('replay changed attendance (%s rows)', n);

  -- 5,000 members --------------------------------------------------------------
  execute 'reset role';
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  select org_a, br_a1, 'Bulk ' || i, '97' || lpad(i::text, 8, '0'), st_a_owner
  from generate_series(1, 5000) i;

  insert into public.memberships
    (org_id, branch_id, member_id, plan_id, plan_name, plan_type,
     start_date, end_date, price_paisa, status)
  select org_a, br_a1, m.id, plan_month, 'Monthly', 'time',
         today_a - 5, today_a + 25, 250000, 'active'
  from public.members m where m.full_name like 'Bulk %' and m.org_id = org_a;

  insert into public.member_cards (org_id, member_id, card_uid)
  select org_a, m.id, upper(lpad(to_hex(16777216 + row_number() over (order by m.id)::int), 8, '0'))
  from public.members m where m.full_name like 'Bulk %' and m.org_id = org_a;

  execute 'set local role service_role';
  t0 := clock_timestamp();
  after_uid := null;
  pages := 0;
  total := 0;
  loop
    result := public.rfid_sync_cards(hash_a, after_uid, 1000);
    pages := pages + 1;
    total := total + jsonb_array_length(result -> 'cards');
    exit when not (result ->> 'more')::boolean;
    after_uid := result ->> 'last_uid';
    assert pages < 20, 'bulk paging did not terminate';
  end loop;
  assert total = 5007, format('bulk sync returned %s cards, expected 5007', total);
  raise notice 'rfid offline: full sync of % cards in % pages took % ms',
    total, pages, round(extract(epoch from clock_timestamp() - t0) * 1000);
  assert extract(epoch from clock_timestamp() - t0) < 15,
    'a 5,000-member sync took more than 15 seconds';

  -- teardown ---------------------------------------------------------------------
  execute 'reset role';
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'rfid offline sync: all assertions passed';
end $$;
