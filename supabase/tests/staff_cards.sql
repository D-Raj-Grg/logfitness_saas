-- Staff cards and clock-in/out: assigning a card, the one-holder-per-UID rule
-- across members and staff, the door answering a staff tap as a clock-in/out
-- (and a member tap exactly as before), the shift rules (double-tap, clock-out,
-- forgotten clock-out), and who may read what.
--
-- Seeds two orgs, drives the real RPCs as real personas, asserts, then removes
-- its fixtures. A failed assertion aborts. rfid_check_in is called as
-- `service_role` with no JWT claims, the same position the rfid-check Edge
-- Function is in.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/staff_cards.sql

do $$
declare
  org_a uuid := 'e1e1e1e1-1111-1111-1111-111111111111';
  org_b uuid := 'e2e2e2e2-2222-2222-2222-222222222222';
  br_a1 uuid := 'e1b00000-0000-0000-0000-000000000001';
  br_a2 uuid := 'e1b00000-0000-0000-0000-000000000002';
  br_b1 uuid := 'e2b00000-0000-0000-0000-000000000001';
  st_owner uuid := 'e1000000-0000-0000-0000-00000000000f';
  st_mgr   uuid := 'e1000000-0000-0000-0000-00000000000a';
  st_desk1 uuid := 'e1000000-0000-0000-0000-00000000000d';
  st_desk2 uuid := 'e1000000-0000-0000-0000-00000000000e';
  st_tr1   uuid := 'e1000000-0000-0000-0000-000000000011';
  st_tr3   uuid := 'e1000000-0000-0000-0000-000000000013';
  st_gone  uuid := 'e1000000-0000-0000-0000-000000000014';
  st_b_owner uuid := 'e2000000-0000-0000-0000-00000000000f';

  plan_month uuid;
  m_ok uuid;
  dev_a1 uuid; dev_a2 uuid;
  hash_a1 text; hash_a2 text;
  result jsonb;
  card public.staff_cards%rowtype;
  mcard public.member_cards%rowtype;
  today_a date;
  n integer;
  failed boolean;
  summary record;
begin
  -- fixtures ------------------------------------------------------------------
  insert into public.orgs (id, name, slug) values
    (org_a, 'Tau Fitness', 'tau-fitness-test'),
    (org_b, 'Upsilon Gyms', 'upsilon-gyms-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Tau One'),
    (br_a2, org_a, 'Tau Two'),
    (br_b1, org_b, 'Upsilon One');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_owner, org_a, 'Tau Owner',   'owner@tau.test',  'owner',      '{}',         'active'),
    (st_mgr,   org_a, 'Tau Manager', 'mgr@tau.test',    'manager',    array[br_a1], 'active'),
    (st_desk1, org_a, 'Tau Desk One','desk1@tau.test',  'front_desk', array[br_a1], 'active'),
    (st_desk2, org_a, 'Tau Desk Two','desk2@tau.test',  'front_desk', array[br_a2], 'active'),
    (st_tr1,   org_a, 'Tau Trainer', 'tr1@tau.test',    'trainer',    array[br_a1], 'active'),
    (st_tr3,   org_a, 'Tau Night',   'tr3@tau.test',    'trainer',    array[br_a1], 'active'),
    (st_gone,  org_a, 'Tau Left',    'gone@tau.test',   'trainer',    array[br_a1], 'inactive'),
    (st_b_owner, org_b, 'Upsilon Owner', 'owner@upsilon.test', 'owner', '{}', 'active');

  today_a := public.org_today(org_a);

  insert into public.membership_plans (org_id, name, plan_type, duration_days, price_paisa)
  values (org_a, 'Monthly', 'time', 30, 250000) returning id into plan_month;

  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Ramesh Member', '9830000001', st_owner) returning id into m_ok;
  insert into public.memberships
    (org_id, branch_id, member_id, plan_id, plan_name, plan_type,
     start_date, end_date, price_paisa, status)
  values (org_a, br_a1, m_ok, plan_month, 'Monthly', 'time',
          today_a - 5, today_a + 25, 250000, 'active');

  -- persona: owner registers two readers ---------------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  result := public.register_device(br_a1, 'Door one');
  dev_a1 := (result ->> 'device_id')::uuid;
  hash_a1 := encode(extensions.digest(result ->> 'key', 'sha256'), 'hex');
  result := public.register_device(br_a2, 'Door two');
  dev_a2 := (result ->> 'device_id')::uuid;
  hash_a2 := encode(extensions.digest(result ->> 'key', 'sha256'), 'hex');

  -- assign ---------------------------------------------------------------------
  card := public.assign_staff_card(st_tr1, 'cc:dd:ee:ff:11:22');
  assert card.card_uid = 'CCDDEEFF1122', 'the staff card uid was not normalised';
  assert card.org_id = org_a and card.staff_id = st_tr1 and card.assigned_by = st_owner,
    'the staff card row is wrong';

  -- the same card again is a no-op, not a second row
  card := public.assign_staff_card(st_tr1, 'CCDDEEFF1122');
  select count(*) into n from public.staff_cards where staff_id = st_tr1;
  assert n = 1, 'assigning the same card twice made two rows';

  -- a second card needs an explicit replace
  failed := false;
  begin
    perform public.assign_staff_card(st_tr1, 'CCDDEEFF9999');
  exception when unique_violation then failed := true;
  end;
  assert failed, 'a staff member got a second live card without replace';

  card := public.assign_staff_card(st_tr1, 'CCDDEEFF9999', true);
  select count(*) into n from public.staff_cards
  where staff_id = st_tr1 and revoked_at is null and card_uid = 'CCDDEEFF9999';
  assert n = 1, 'replace did not leave exactly one live card';
  select count(*) into n from public.staff_cards
  where staff_id = st_tr1 and revoked_at is not null and revoke_reason = 'Replaced';
  assert n = 1, 'replace did not revoke the old card with reason Replaced';

  -- an inactive person gets no card
  failed := false;
  begin
    perform public.assign_staff_card(st_gone, 'AA11BB22CC33');
  exception when check_violation then failed := true;
  end;
  assert failed, 'an inactive staff member was given a card';

  -- one holder per UID, across both tables -------------------------------------
  failed := false;
  begin
    perform public.assign_staff_card(st_desk1, 'CCDDEEFF9999');
  exception when unique_violation then failed := true;
  end;
  assert failed, 'two staff members shared one card';

  failed := false;
  begin
    perform public.assign_member_card(m_ok, 'CCDDEEFF9999');
  exception when unique_violation then failed := true;
  end;
  assert failed, 'a member was given a staff member''s card';

  mcard := public.assign_member_card(m_ok, 'AABBCCDD0001');
  failed := false;
  begin
    perform public.assign_staff_card(st_desk1, 'AABBCCDD0001');
  exception when unique_violation then failed := true;
  end;
  assert failed, 'a staff member was given a member''s card';

  -- the trigger holds even when the RPC pre-checks are bypassed
  execute 'reset role';
  failed := false;
  begin
    insert into public.staff_cards (org_id, staff_id, card_uid, assigned_by)
    values (org_a, st_desk1, 'AABBCCDD0001', st_owner);
  exception when unique_violation then failed := true;
  end;
  assert failed, 'the trigger let a staff card duplicate a member card';
  failed := false;
  begin
    insert into public.member_cards (org_id, member_id, card_uid, assigned_by)
    values (org_a, m_ok, 'CCDDEEFF9999', st_owner);
  exception when unique_violation then failed := true;
  end;
  assert failed, 'the trigger let a member card duplicate a staff card';

  -- immutability
  failed := false;
  begin
    update public.staff_cards set card_uid = 'FFFFFFFF0000' where staff_id = st_tr1;
  exception when restrict_violation then failed := true;
  end;
  assert failed, 'a staff card assignment was edited';

  -- who may assign ---------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_mgr::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  card := public.assign_staff_card(st_desk1, 'DD00DD00DD01');
  assert card.assigned_by = st_mgr, 'a manager could not card their own front desk';

  failed := false;
  begin
    perform public.assign_staff_card(st_desk2, 'DD00DD00DD02');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a manager carded staff at a branch they do not cover';

  failed := false;
  begin
    perform public.assign_staff_card(st_owner, 'DD00DD00DD03');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a manager carded an owner';

  -- the front desk may not assign staff cards at all
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk1::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.assign_staff_card(st_tr3, 'DD00DD00DD04');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'the front desk assigned a staff card';

  select count(*) into n from public.staff_cards;
  assert n = 1, format('a front desk user should see only their own card, saw %s', n);

  -- owner cards the rest, then the door ------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  perform public.assign_staff_card(st_tr3, 'DD00DD00DD04');
  perform public.assign_staff_card(st_owner, 'DD00DD00DD05');

  -- a stranger sits in the inbox until it is assigned, then leaves it
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  execute 'set local role service_role';
  result := public.rfid_check_in(hash_a1, 'EE11EE11EE11');
  assert result ->> 'reason' = 'unknown_card', 'a stranger was not unknown';
  select count(*) into n from public.unassigned_card_scans where card_uid = 'EE11EE11EE11';
  assert n = 1, 'the stranger did not land in the inbox';

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  perform public.assign_staff_card(st_desk2, 'EE11EE11EE11');
  select count(*) into n from public.unassigned_card_scans where card_uid = 'EE11EE11EE11';
  assert n = 0, 'assigning a staff card left the stranger in the inbox';

  -- the door -----------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  execute 'set local role service_role';

  -- the replaced card no longer opens anything
  result := public.rfid_check_in(hash_a1, 'CCDDEEFF1122');
  assert result ->> 'reason' = 'unknown_card', 'a replaced staff card still worked';

  -- clock in
  result := public.rfid_check_in(hash_a1, 'CCDDEEFF9999');
  assert result ->> 'decision' = 'allow' and result ->> 'reason' = 'staff_in'
    and result ->> 'clock' = 'in' and result ->> 'kind' = 'staff',
    format('a staff tap did not clock in: %s', result);
  assert result ->> 'member_name' = 'Tau Trainer' and result ->> 'member_code' = 'STAFF',
    'the reader would show the wrong name for a staff tap';
  assert (result -> 'days_to_expiry') = 'null'::jsonb, 'a staff tap carried a days-to-expiry';

  -- a double-tap is not a clock-out
  result := public.rfid_check_in(hash_a1, 'CCDDEEFF9999');
  assert result ->> 'decision' = 'allow' and result ->> 'reason' = 'staff_already_in'
    and (result ->> 'already_checked_in_today')::boolean,
    format('a double tap was not answered already-in: %s', result);

  select count(*) into n from public.staff_attendance where staff_id = st_tr1;
  assert n = 1, format('a double tap made %s shifts', n);

  -- a staff tap never touches member attendance
  select count(*) into n from public.attendance a where a.org_id = org_a;
  assert n = 0, 'a staff tap wrote member attendance';

  -- clock out: an open shift that is old enough
  execute 'reset role';
  insert into public.staff_attendance (org_id, staff_id, branch_id, device_id, clocked_in_at)
  values (org_a, st_desk1, br_a1, dev_a1, now() - interval '10 minutes');
  execute 'set local role service_role';

  result := public.rfid_check_in(hash_a1, 'DD00DD00DD01');
  assert result ->> 'reason' = 'staff_out' and result ->> 'clock' = 'out',
    format('a later tap did not clock out: %s', result);
  select count(*) into n from public.staff_attendance
  where staff_id = st_desk1 and clocked_out_at is not null and out_source = 'card';
  assert n = 1, 'the shift was not closed';

  -- and the next tap starts a second shift the same day
  execute 'reset role';
  update public.staff_attendance set clocked_out_at = clocked_out_at where staff_id = st_desk1;
  execute 'set local role service_role';
  result := public.rfid_check_in(hash_a1, 'DD00DD00DD01');
  assert result ->> 'clock' = 'in', 'a second shift in a day did not start';
  select count(*) into n from public.staff_attendance where staff_id = st_desk1;
  assert n = 2, format('expected two shifts, found %s', n);

  -- a forgotten clock-out: closed with no invented end time, new shift starts
  execute 'reset role';
  insert into public.staff_attendance (org_id, staff_id, branch_id, device_id, clocked_in_at)
  values (org_a, st_tr3, br_a1, dev_a1, now() - interval '17 hours');
  execute 'set local role service_role';

  result := public.rfid_check_in(hash_a1, 'DD00DD00DD04');
  assert result ->> 'clock' = 'in', format('a stale shift was not restarted: %s', result);
  select count(*) into n from public.staff_attendance
  where staff_id = st_tr3 and auto_closed and clocked_out_at is null;
  assert n = 1, 'the forgotten shift was not auto-closed without a clock-out time';
  select count(*) into n from public.staff_attendance
  where staff_id = st_tr3 and not auto_closed and clocked_out_at is null;
  assert n = 1, 'there is not exactly one open shift after the restart';

  -- wrong branch, inactive, owner anywhere
  result := public.rfid_check_in(hash_a2, 'CCDDEEFF9999');
  assert result ->> 'decision' = 'deny' and result ->> 'reason' = 'staff_wrong_branch',
    format('a trainer got through a branch they do not work at: %s', result);
  select count(*) into n from public.staff_attendance sa
  where sa.staff_id = st_tr1 and sa.branch_id = br_a2;
  assert n = 0, 'a denied tap wrote a shift';

  result := public.rfid_check_in(hash_a2, 'DD00DD00DD05');
  assert result ->> 'decision' = 'allow' and result ->> 'clock' = 'in',
    format('the owner was refused at a branch: %s', result);

  execute 'reset role';
  update public.staff set status = 'inactive' where id = st_tr1;
  execute 'set local role service_role';
  result := public.rfid_check_in(hash_a1, 'CCDDEEFF9999');
  assert result ->> 'decision' = 'deny' and result ->> 'reason' = 'staff_inactive',
    format('a deactivated staff member got through: %s', result);
  execute 'reset role';
  update public.staff set status = 'active' where id = st_tr1;
  execute 'set local role service_role';

  -- a MEMBER tap still behaves exactly as it did
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  execute 'set local role service_role';

  result := public.rfid_check_in(hash_a1, 'AABBCCDD0001');
  assert result ->> 'decision' = 'allow' and result ->> 'member_name' = 'Ramesh Member'
    and result ->> 'kind' is null,
    format('a member tap changed: %s', result);
  select count(*) into n from public.attendance a where a.member_id = m_ok and a.device_id = dev_a1;
  assert n = 1, 'a member tap did not write member attendance';

  -- revoke: needs a reason, then the card is a stranger again
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_mgr::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.revoke_staff_card(st_desk1, '  ');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a card was revoked with no reason';

  failed := false;
  begin
    perform public.revoke_staff_card(st_owner, 'Lost');
  exception when no_data_found then failed := true;
  end;
  assert failed, 'a manager revoked an owner''s card';

  card := public.revoke_staff_card(st_desk1, 'Lost it');
  assert card.revoked_by = st_mgr and card.revoke_reason = 'Lost it', 'the revoke did not record who and why';
  assert card.revoked_at > now() - interval '1 minute', 'a revocation was not stamped with the server time';

  -- direct writes through the API cannot be better than the RPC
  select count(*) into n from public.staff_cards where staff_id = st_owner;
  assert n = 0, 'a manager read an owner''s card';
  select count(*) into n from public.staff_cards where staff_id = st_desk2;
  assert n = 0, 'a manager read a card at a branch they do not cover';
  select count(*) into n from public.staff_cards where staff_id = st_desk1;
  assert n >= 1, 'a manager could not read their own front desk''s cards';

  failed := false;
  begin
    insert into public.staff_cards (org_id, staff_id, card_uid, assigned_by, revoked_at, revoked_by, revoke_reason)
    values (org_a, st_desk1, 'DD00DD00DD06', st_mgr, now(), st_mgr, 'x');
  exception when insufficient_privilege or check_violation then failed := true;
  end;
  assert failed, 'a manager inserted a card that was already revoked';

  failed := false;
  begin
    insert into public.staff_cards (org_id, staff_id, card_uid, assigned_by)
    values (org_a, st_gone, 'DD00DD00DD06', st_mgr);
  exception when check_violation then failed := true;
  end;
  assert failed, 'a manager inserted a card for a deactivated person';

  insert into public.staff_cards (org_id, staff_id, card_uid, assigned_by, assigned_at, created_at)
  values (org_a, st_desk1, 'DD00DD00DD07', st_mgr, '2020-01-01', '2020-01-01')
  returning * into card;
  assert card.assigned_at > now() - interval '1 minute', 'a card assignment was backdated';

  update public.staff_cards
  set revoked_at = '2020-01-01', revoked_by = st_mgr, revoke_reason = 'Backdated'
  where staff_id = st_desk1 and revoked_at is null
  returning * into card;
  assert card.revoked_at > now() - interval '1 minute', 'a revocation was backdated';

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  execute 'set local role service_role';
  result := public.rfid_check_in(hash_a1, 'DD00DD00DD01');
  assert result ->> 'reason' = 'unknown_card', 'a revoked staff card still worked';

  -- who may read the time records ---------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_mgr::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.staff_attendance where branch_id = br_a2;
  assert n = 0, 'a manager read time records at a branch they do not cover';
  select count(*) into n from public.staff_attendance where branch_id = br_a1;
  assert n >= 4, format('a manager could not read their own branch, saw %s', n);

  select * into summary from public.staff_attendance_summary(st_tr3, today_a - 1, today_a + 1);
  assert summary.lifetime_days >= 1 and summary.on_shift, 'the summary missed an open shift';
  assert summary.open_shifts_in_range = 1, format('summary open shifts: %s', summary.open_shifts_in_range);
  assert summary.forgotten_shifts_in_range = 1,
    format('summary forgotten shifts: %s', summary.forgotten_shifts_in_range);

  -- direct writes are not a thing
  failed := false;
  begin
    insert into public.staff_attendance (org_id, staff_id, branch_id)
    values (org_a, st_mgr, br_a1);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a signed-in user inserted a time record directly';

  -- (no write privilege at all now, so this is refused outright rather than
  -- filtered to zero rows by RLS)
  failed := false;
  begin
    update public.staff_attendance set clocked_out_at = now() where staff_id = st_tr3;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a signed-in user closed a shift directly';
  failed := false;
  begin
    delete from public.staff_cards;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a signed-in user deleted staff cards';

  -- a desk user sees only their own shifts
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk2::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a2::text)
  )::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.staff_attendance where staff_id <> st_desk2;
  assert n = 0, 'a front desk user read a colleague''s time records';

  -- another org sees none of it ----------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.staff_attendance;
  assert n = 0, 'org B read org A''s time records';
  select count(*) into n from public.staff_cards;
  assert n = 0, 'org B read org A''s staff cards';

  failed := false;
  begin
    perform public.assign_staff_card(st_tr1, 'BB00BB00BB00');
  exception when insufficient_privilege or no_data_found then failed := true;
  end;
  assert failed, 'org B carded org A''s staff';

  -- teardown -------------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'staff cards: all assertions passed';
end $$;
