-- RFID gate: device registration and key hygiene, card assignment, the door
-- decision (rfid_check_in) for every membership state, the enrollment inbox,
-- and the cross-tenant negative tests devices, member_cards and
-- unassigned_card_scans owe on the way in.
--
-- Seeds two orgs, drives the real RPCs as real personas, asserts the behaviour
-- and the isolation, then removes its fixtures. A failed assertion aborts.
-- rfid_check_in is called after `reset role` with no JWT claims -- the same
-- position the rfid-check Edge Function's service-role client is in.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rfid_check_in.sql

do $$
declare
  org_a uuid := 'f1f1f1f1-1111-1111-1111-111111111111';
  org_b uuid := 'f2f2f2f2-2222-2222-2222-222222222222';
  br_a1 uuid := 'f1b00000-0000-0000-0000-000000000001';
  br_a2 uuid := 'f1b00000-0000-0000-0000-000000000002';
  br_b1 uuid := 'f2b00000-0000-0000-0000-000000000001';
  st_a_owner uuid := 'f1000000-0000-0000-0000-00000000000f';
  st_a_mgr   uuid := 'f1000000-0000-0000-0000-00000000000a';
  st_a_desk1 uuid := 'f1000000-0000-0000-0000-00000000000d';
  st_a_desk2 uuid := 'f1000000-0000-0000-0000-00000000000e';
  st_b_owner uuid := 'f2000000-0000-0000-0000-00000000000f';

  plan_month uuid;
  plan_b uuid;
  m_ok uuid;        -- active, nothing owing
  m_due uuid;       -- active, owing money
  m_expiring uuid;  -- three days left, nothing owing
  m_expired uuid;
  m_frozen uuid;
  m_none uuid;      -- never bought a membership
  m_b uuid;         -- org B, active
  ok_code text;

  dev_a1 uuid;
  dev_a2 uuid;
  dev_b uuid;
  key_a1 text;
  key_a2 text;
  key_b text;
  hash_a1 text;
  hash_a2 text;
  hash_b text;

  result jsonb;
  card public.member_cards%rowtype;
  visit_1 uuid;
  n integer;
  txt text;
  failed boolean;
  today_a date;
begin
  -- fixtures, as the owning role so RLS is out of the way --------------------
  insert into public.orgs (id, name, slug) values
    (org_a, 'Rho Fitness', 'rho-fitness-test'),
    (org_b, 'Sigma Gyms', 'sigma-gyms-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Rho Baneshwor'),
    (br_a2, org_a, 'Rho Patan'),
    (br_b1, org_b, 'Sigma Bhaktapur');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_a_owner, org_a, 'Rho Owner',    'owner@rho.test',   'owner',      '{}',         'active'),
    (st_a_mgr,   org_a, 'Rho Manager',  'mgr@rho.test',     'manager',    array[br_a1], 'active'),
    (st_a_desk1, org_a, 'Rho Desk One', 'desk1@rho.test',   'front_desk', array[br_a1], 'active'),
    (st_a_desk2, org_a, 'Rho Desk Two', 'desk2@rho.test',   'front_desk', array[br_a2], 'active'),
    (st_b_owner, org_b, 'Sigma Owner',  'owner@sigma.test', 'owner',      '{}',         'active');

  today_a := public.org_today(org_a);

  insert into public.membership_plans (org_id, name, plan_type, duration_days, price_paisa)
  values (org_a, 'Monthly', 'time', 30, 250000)
  returning id into plan_month;
  insert into public.membership_plans (org_id, name, plan_type, duration_days, price_paisa)
  values (org_b, 'Monthly', 'time', 30, 200000)
  returning id into plan_b;

  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Ramesh Thapa', '9820000001', st_a_owner) returning id into m_ok;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Gita Karki', '9820000002', st_a_owner) returning id into m_due;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Hari Bhandari', '9820000003', st_a_owner) returning id into m_expiring;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Sita Gurung', '9820000004', st_a_owner) returning id into m_expired;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Kiran Tamang', '9820000005', st_a_owner) returning id into m_frozen;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Maya Shrestha', '9820000006', st_a_owner) returning id into m_none;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_b, br_b1, 'Sigma Member', '9820000007', st_b_owner) returning id into m_b;

  insert into public.memberships
    (org_id, branch_id, member_id, plan_id, plan_name, plan_type,
     start_date, end_date, price_paisa, status, frozen_on)
  values
    (org_a, br_a1, m_ok,       plan_month, 'Monthly', 'time', today_a - 5,  today_a + 25, 250000, 'active',  null),
    (org_a, br_a1, m_expiring, plan_month, 'Monthly', 'time', today_a - 27, today_a + 3,  250000, 'active',  null),
    (org_a, br_a1, m_expired,  plan_month, 'Monthly', 'time', today_a - 40, today_a - 10, 250000, 'expired', null),
    (org_a, br_a1, m_frozen,   plan_month, 'Monthly', 'time', today_a - 5,  today_a + 25, 250000, 'frozen',  today_a - 1),
    (org_b, br_b1, m_b,        plan_b,     'Monthly', 'time', today_a - 5,  today_a + 25, 200000, 'active',  null);

  select m.member_code into ok_code from public.members m where m.id = m_ok;

  -- persona: org A owner -- sells m_due a plan with nothing paid, registers readers
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  result := public.renew_membership(m_due, plan_month, br_a1, today_a, 0, 0, 'cash');

  result := public.register_device(br_a1, '  Front door  ');
  dev_a1 := (result ->> 'device_id')::uuid;
  key_a1 := result ->> 'key';
  assert result ->> 'name' = 'Front door', 'the device name was not trimmed';
  assert key_a1 ~ '^lgd_[A-Za-z0-9_-]{43}$',
    format('the device key has the wrong shape: %s', left(key_a1, 8));
  hash_a1 := encode(extensions.digest(key_a1, 'sha256'), 'hex');

  select count(*) into n from public.devices d
  where d.id = dev_a1 and d.key_hash = hash_a1 and d.key_prefix = left(key_a1, 8)
    and d.created_by = st_a_owner and d.status = 'active' and d.branch_id = br_a1;
  assert n = 1, 'the device row does not hold the sha256 of its key';

  select count(*) into n from public.devices d where d.key_hash = key_a1;
  assert n = 0, 'the plaintext key was stored';

  result := public.register_device(br_a2, 'Back door');
  dev_a2 := (result ->> 'device_id')::uuid;
  key_a2 := result ->> 'key';
  hash_a2 := encode(extensions.digest(key_a2, 'sha256'), 'hex');

  failed := false;
  begin
    perform public.register_device(br_a1, 'Front door');
  exception when unique_violation then failed := true;
  end;
  assert failed, 'two devices in one org got the same name';

  failed := false;
  begin
    perform public.register_device(br_b1, 'Not mine');
  exception when no_data_found then failed := true;
  end;
  assert failed, 'org A registered a device at an org B branch';

  -- rotate: the old key stops existing.
  result := public.rotate_device_key(dev_a2);
  assert result ->> 'key' <> key_a2, 'rotation returned the same key';
  key_a2 := result ->> 'key';
  select count(*) into n from public.devices d where d.key_hash = hash_a2;
  assert n = 0, 'the rotated-out key hash is still live';
  hash_a2 := encode(extensions.digest(key_a2, 'sha256'), 'hex');

  -- No direct writes: the RPCs are the only door.
  failed := false;
  begin
    insert into public.devices (org_id, branch_id, name, key_hash, key_prefix)
    values (org_a, br_a1, 'Sneaky', 'x', 'x');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a staff member inserted a device directly';

  update public.devices set status = 'disabled' where id = dev_a1;
  select count(*) into n from public.devices d where d.id = dev_a1 and d.status = 'active';
  assert n = 1, 'a staff member updated a device directly';

  -- persona: org A front desk, branch 1 -- may not manage readers ------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk1::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.register_device(br_a1, 'Desk door');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'the front desk registered a device';

  failed := false;
  begin
    perform public.update_device(dev_a1, null, 'disabled');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'the front desk disabled a device';

  select count(*) into n from public.devices;
  assert n = 2, format('the front desk should see 2 org devices, saw %s', n);

  -- A signed-in user is never a device.
  failed := false;
  begin
    perform public.rfid_check_in(hash_a1, '04A31B2C');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'an authenticated user executed rfid_check_in';

  -- persona: org A manager, branch 1 only -------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_mgr::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.register_device(br_a2, 'Patan side door');
  exception when no_data_found then failed := true;
  end;
  assert failed, 'a branch 1 manager registered a device at branch 2';

  failed := false;
  begin
    perform public.rotate_device_key(dev_a2);
  exception when no_data_found then failed := true;
  end;
  assert failed, 'a branch 1 manager rotated a branch 2 key';

  result := public.update_device(dev_a1, 'Main door', null);
  assert result ->> 'name' = 'Main door', 'the manager could not rename their reader';
  assert result ->> 'status' = 'active', 'a rename changed the status';
  assert not (result ? 'key_hash'), 'update_device returned the key hash';

  -- the door, as the Edge Function: no JWT ------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  result := public.rfid_check_in('0000', '04A31B2C');
  assert result ->> 'decision' = 'deny' and result ->> 'reason' = 'device_unknown',
    format('a wrong key gave %s', result);

  result := public.rfid_check_in(hash_a1, ' : - ');
  assert result ->> 'reason' = 'bad_uid', format('an empty uid gave %s', result);

  result := public.rfid_check_in(hash_a1, '04:a3:1b:2c');
  assert result ->> 'decision' = 'deny' and result ->> 'reason' = 'unknown_card',
    format('an unknown card gave %s', result);
  assert result ->> 'device_name' = 'Main door' and result ->> 'branch_name' = 'Rho Baneshwor',
    format('the unknown-card answer did not name the reader: %s', result);

  select s.scan_count into n from public.unassigned_card_scans s
  where s.device_id = dev_a1 and s.card_uid = '04A31B2C' and s.branch_id = br_a1;
  assert n = 1, 'the first unknown tap did not land in the inbox';

  result := public.rfid_check_in(hash_a1, '04A31B2C');
  select s.scan_count into n from public.unassigned_card_scans s
  where s.device_id = dev_a1 and s.card_uid = '04A31B2C';
  assert n = 2, format('a second unknown tap counted %s', n);

  select count(*) into n from public.devices d
  where d.id = dev_a1 and d.last_seen_at is not null;
  assert n = 1, 'the reader''s last_seen_at was not touched';

  -- The same card at the other branch, and one more stranger there.
  result := public.rfid_check_in(hash_a2, '04A31B2C');
  result := public.rfid_check_in(hash_a2, 'DEADBEEF');

  -- A week-old scan is pruned the next time that reader sees a stranger.
  update public.unassigned_card_scans set last_seen_at = now() - interval '8 days'
  where device_id = dev_a2 and card_uid = 'DEADBEEF';
  result := public.rfid_check_in(hash_a2, 'CAFEBABE');
  select count(*) into n from public.unassigned_card_scans s
  where s.device_id = dev_a2 and s.card_uid = 'DEADBEEF';
  assert n = 0, 'a scan older than a week was not pruned';

  -- persona: front desk branch 1 sees only branch 1's inbox -------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk1::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.unassigned_card_scans;
  assert n = 1, format('branch 1 desk saw %s inbox rows, expected 1', n);

  failed := false;
  begin
    insert into public.unassigned_card_scans (org_id, branch_id, device_id, card_uid)
    values (org_a, br_a1, dev_a1, 'ABCDEF01');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a staff member wrote the scan inbox directly';

  -- assign: the card leaves the inbox and opens the door ----------------------
  card := public.assign_member_card(m_ok, '04 a3 1b 2c');
  assert card.card_uid = '04A31B2C', format('the uid was stored as %L', card.card_uid);
  assert card.assigned_by = st_a_desk1, 'the card was not signed by the desk';
  assert card.revoked_at is null, 'a fresh card came back revoked';

  select count(*) into n from public.unassigned_card_scans s where s.card_uid = '04A31B2C';
  assert n = 0, 'the assigned card is still in the branch 1 inbox';

  -- persona: front desk branch 2 sees only branch 2's inbox. The branch 2 copy
  -- of the card was out of reach of the branch 1 desk's delete (RLS), so it
  -- stays until its reader prunes it -- the picker must hide live cards.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk2::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a2::text)
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.unassigned_card_scans s where s.branch_id = br_a1;
  assert n = 0, 'branch 2 desk saw branch 1 inbox rows';
  select count(*) into n from public.unassigned_card_scans s where s.card_uid = 'CAFEBABE';
  assert n = 1, 'branch 2 desk could not see its own inbox';

  delete from public.unassigned_card_scans s where s.card_uid = '04A31B2C';
  get diagnostics n = row_count;
  assert n = 1, 'branch 2 desk could not clear its own inbox row';

  -- the door: allow, and what it writes ---------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  result := public.rfid_check_in(hash_a1, '04A31B2C', now());
  assert result ->> 'decision' = 'allow', format('an active member was refused: %s', result);
  assert result ->> 'reason' = 'active' and result ->> 'status' = 'active',
    format('an active member got %s', result);
  assert result ->> 'member_name' = 'Ramesh Thapa' and result ->> 'member_code' = ok_code,
    format('the door named the wrong member: %s', result);
  assert (result ->> 'due_paisa')::bigint = 0, 'an active member showed dues';
  assert (result ->> 'days_to_expiry')::int = 25,
    format('days_to_expiry was %s', result ->> 'days_to_expiry');
  assert not (result ->> 'already_checked_in_today')::boolean, 'a first tap said already in';
  assert result ->> 'device_name' = 'Main door' and result ->> 'branch_name' = 'Rho Baneshwor',
    'the allow did not name the reader';
  visit_1 := (result ->> 'attendance_id')::uuid;
  assert visit_1 is not null, 'an allow wrote no attendance row';

  select count(*) into n from public.attendance a
  where a.id = visit_1 and a.method = 'card' and a.checked_in_by is null
    and a.device_id = dev_a1 and a.branch_id = br_a1 and a.org_id = org_a
    and a.attended_on = today_a and a.membership_status_at_checkin = 'active'
    and a.days_to_expiry_at_checkin = 25 and a.due_paisa_at_checkin = 0
    and not a.is_override;
  assert n = 1, 'the card visit was not written as method card / no staff / this reader';

  select count(*) into n from public.audit_log l
  where l.entity = 'attendance' and l.entity_id = visit_1::text and l.action = 'INSERT'
    and l.actor_staff_id is null and l.actor_auth_user_id is null and l.org_id = org_a;
  assert n = 1, 'the card visit was not audited with a null actor';

  select count(*) into n from public.audit_log l
  where l.entity = 'devices' and l.entity_id = dev_a1::text and l.action = 'UPDATE';
  assert n = 1, format('expected 1 device audit row (the rename), found %s -- taps must not audit', n);

  -- the same day, again: a no-op that still opens -----------------------------
  result := public.rfid_check_in(hash_a1, '04A31B2C');
  assert result ->> 'decision' = 'allow', 'a second tap was refused';
  assert (result ->> 'already_checked_in_today')::boolean, 'a second tap was not flagged';
  assert (result ->> 'attendance_id')::uuid = visit_1, 'a second tap pointed at another visit';
  select count(*) into n from public.attendance a where a.member_id = m_ok;
  assert n = 1, format('a second tap wrote a duplicate visit (%s rows)', n);

  -- the record is evidence ----------------------------------------------------
  failed := false;
  begin
    update public.attendance set device_id = dev_a2 where id = visit_1;
  exception when restrict_violation then failed := true;
  end;
  assert failed, 'the reader on a visit was rewritten';

  -- persona: desk branch 1 reads the visit with the reader's name -------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk1::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  select d.device_name into txt from public.attendance_detail d where d.id = visit_1;
  assert txt = 'Main door', format('attendance_detail.device_name was %L', txt);
  select d.checked_in_by_name into txt from public.attendance_detail d where d.id = visit_1;
  assert txt is null, 'a device visit was attributed to a person';

  -- every other membership state ------------------------------------------------
  perform public.assign_member_card(m_due, '11111111');
  perform public.assign_member_card(m_expiring, 'AABBCCDD');
  perform public.assign_member_card(m_expired, '22222222');
  perform public.assign_member_card(m_frozen, '33333333');
  perform public.assign_member_card(m_none, '44444444');

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  result := public.rfid_check_in(hash_a1, '11111111');
  assert result ->> 'decision' = 'deny' and result ->> 'reason' = 'dues',
    format('a member owing money got %s', result);
  assert (result ->> 'due_paisa')::bigint > 0, 'the dues denial did not say how much';
  assert result ->> 'attendance_id' is null, 'a dues denial pointed at a visit';

  result := public.rfid_check_in(hash_a1, 'AABBCCDD');
  assert result ->> 'decision' = 'allow' and result ->> 'reason' = 'expiring',
    format('an expiring member with no dues got %s', result);
  assert (result ->> 'days_to_expiry')::int = 3, 'the expiring member''s days were wrong';

  result := public.rfid_check_in(hash_a1, '22222222');
  assert result ->> 'decision' = 'deny' and result ->> 'reason' = 'expired',
    format('an expired member got %s', result);

  result := public.rfid_check_in(hash_a1, '33333333');
  assert result ->> 'decision' = 'deny' and result ->> 'reason' = 'frozen',
    format('a frozen member got %s', result);

  result := public.rfid_check_in(hash_a1, '44444444');
  assert result ->> 'decision' = 'deny' and result ->> 'reason' = 'none',
    format('a member with no membership got %s', result);

  select count(*) into n from public.attendance a
  where a.member_id in (m_due, m_expired, m_frozen, m_none);
  assert n = 0, format('denied taps wrote %s attendance rows', n);

  select count(*) into n from public.attendance a where a.member_id = m_expiring;
  assert n = 1, 'the expiring member''s allow wrote no visit';

  -- one card, one member; one member, one card ----------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk1::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.assign_member_card(m_none, '04-A3-1B-2C', true);
  exception when unique_violation then
    get stacked diagnostics txt = message_text;
    failed := true;
  end;
  assert failed, 'a live card was handed to a second member';
  assert txt = 'That card belongs to ' || ok_code, format('the refusal said %L', txt);

  failed := false;
  begin
    perform public.assign_member_card(m_ok, '55555555');
  exception when unique_violation then failed := true;
  end;
  assert failed, 'a member was given a second live card without replace';

  -- The partial index holds even if the RPC is bypassed. m_none's own card is
  -- revoked first so only the uid index can be the one that fires.
  perform public.revoke_member_card(m_none, 'Testing the index');
  failed := false;
  begin
    insert into public.member_cards (org_id, member_id, card_uid, assigned_by)
    values (org_a, m_none, '04A31B2C', st_a_desk1);
  exception when unique_violation then
    get stacked diagnostics txt = constraint_name;
    failed := true;
  end;
  assert failed, 'a duplicate live uid was inserted directly';
  assert txt = 'member_cards_live_uid_key', format('the wrong index fired: %L', txt);

  failed := false;
  begin
    perform public.assign_member_card(m_ok, 'XYZ');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a malformed uid was accepted';

  card := public.assign_member_card(m_ok, '55555555', true);
  assert card.card_uid = '55555555' and card.revoked_at is null, 'the replacement card is not live';

  select count(*) into n from public.member_cards mc
  where mc.member_id = m_ok and mc.card_uid = '04A31B2C'
    and mc.revoked_at is not null and mc.revoke_reason = 'Replaced'
    and mc.revoked_by = st_a_desk1;
  assert n = 1, 'the replaced card was not revoked as Replaced';

  -- revoke ------------------------------------------------------------------------
  failed := false;
  begin
    perform public.revoke_member_card(m_ok, '   ');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a card was revoked with no reason';

  card := public.revoke_member_card(m_ok, 'Lost');
  assert card.revoke_reason = 'Lost' and card.revoked_by = st_a_desk1, 'the revocation was not signed';

  failed := false;
  begin
    perform public.revoke_member_card(m_ok, 'Lost again');
  exception when no_data_found then failed := true;
  end;
  assert failed, 'a member with no live card had one revoked';

  -- A revoked card is history; it never comes back to life.
  failed := false;
  begin
    update public.member_cards set revoked_at = null, revoked_by = null, revoke_reason = null
    where id = card.id;
  exception when restrict_violation then failed := true;
  end;
  assert failed, 'a revoked card was un-revoked';

  failed := false;
  begin
    update public.member_cards set card_uid = '66666666' where id = card.id;
  exception when restrict_violation then failed := true;
  end;
  assert failed, 'a card assignment was rewritten';

  delete from public.member_cards where id = card.id;
  get diagnostics n = row_count;
  assert n = 0, 'a card assignment was deleted';

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  result := public.rfid_check_in(hash_a1, '04A31B2C');
  assert result ->> 'reason' = 'unknown_card', format('a replaced card gave %s', result);
  result := public.rfid_check_in(hash_a1, '55555555');
  assert result ->> 'reason' = 'unknown_card', format('a revoked card gave %s', result);

  -- disabled reader ----------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  result := public.update_device(dev_a1, null, 'disabled');
  assert result ->> 'status' = 'disabled', 'the owner could not disable a reader';

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  result := public.rfid_check_in(hash_a1, 'AABBCCDD');
  assert result ->> 'decision' = 'deny' and result ->> 'reason' = 'device_disabled',
    format('a disabled reader gave %s', result);
  result := public.rfid_check_in(key_a1, 'AABBCCDD');
  assert result ->> 'reason' = 'device_unknown', 'the plaintext key was accepted as a hash';

  -- cross-tenant -------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.devices;
  assert n = 0, format('org B saw %s devices before registering any', n);
  select count(*) into n from public.member_cards;
  assert n = 0, format('org B saw %s org A cards', n);
  select count(*) into n from public.unassigned_card_scans;
  assert n = 0, format('org B saw %s org A inbox rows', n);
  select count(*) into n from public.attendance_detail d where d.org_id = org_a;
  assert n = 0, 'org B read org A visits';

  failed := false;
  begin
    perform public.update_device(dev_a2, 'Mine now', null);
  exception when no_data_found then failed := true;
  end;
  assert failed, 'org B renamed an org A reader';

  failed := false;
  begin
    perform public.rotate_device_key(dev_a2);
  exception when no_data_found then failed := true;
  end;
  assert failed, 'org B rotated an org A key';

  failed := false;
  begin
    perform public.assign_member_card(m_ok, '77777777');
  exception when no_data_found then failed := true;
  end;
  assert failed, 'org B gave an org A member a card';

  failed := false;
  begin
    perform public.revoke_member_card(m_expiring, 'Not yours');
  exception when no_data_found then failed := true;
  end;
  assert failed, 'org B revoked an org A card';

  -- The same physical uid is a separate card in another org.
  card := public.assign_member_card(m_b, 'AABBCCDD');
  assert card.org_id = org_b, 'org B''s card landed in another org';

  result := public.register_device(br_b1, 'Main door');
  dev_b := (result ->> 'device_id')::uuid;
  key_b := result ->> 'key';
  hash_b := encode(extensions.digest(key_b, 'sha256'), 'hex');

  delete from public.unassigned_card_scans;
  delete from public.attendance where org_id = org_a;

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  select count(*) into n from public.attendance a where a.org_id = org_a;
  assert n = 2, format('org B deleted org A visits (%s left)', n);
  select count(*) into n from public.unassigned_card_scans s where s.org_id = org_a;
  assert n > 0, 'org B cleared org A''s inbox';

  result := public.rfid_check_in(hash_b, 'AABBCCDD');
  assert result ->> 'decision' = 'allow' and result ->> 'member_name' = 'Sigma Member',
    format('org B''s reader resolved the uid to %s', result);
  assert result ->> 'branch_name' = 'Sigma Bhaktapur', 'org B''s reader named another branch';

  select count(*) into n from public.attendance a
  where a.id = (result ->> 'attendance_id')::uuid and a.org_id = org_b and a.device_id = dev_b;
  assert n = 1, 'org B''s visit was not written in org B';

  -- An org B reader never sees org A's card, and an org A stranger never lands
  -- in org B's inbox.
  result := public.rfid_check_in(hash_b, '11111111');
  assert result ->> 'reason' = 'unknown_card', 'org B''s reader recognised an org A card';
  select count(*) into n from public.unassigned_card_scans s
  where s.card_uid = '11111111' and s.org_id = org_b and s.branch_id = br_b1;
  assert n = 1, 'org B''s stranger did not land in org B''s inbox';

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.member_cards mc where mc.card_uid = 'AABBCCDD';
  assert n = 1, format('org A saw %s cards with that uid, expected only its own', n);
  select count(*) into n from public.unassigned_card_scans s where s.org_id = org_b;
  assert n = 0, 'org A saw org B''s inbox';
  select count(*) into n from public.devices d where d.org_id = org_b;
  assert n = 0, 'org A saw org B''s reader';

  -- teardown ---------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'rfid check-in: all assertions passed';
end $$;
