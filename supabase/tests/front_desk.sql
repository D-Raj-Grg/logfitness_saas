-- Phase 2 gate: check-in, the duplicate rule, check-out, the in-gym roster and
-- the absence report, plus the cross-tenant negative tests the attendance table
-- owes on the way in.
--
-- Seeds two orgs, drives the real RPCs as real personas, asserts the behaviour
-- and the isolation, then removes its fixtures. A failed assertion aborts.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/front_desk.sql

do $$
declare
  org_a uuid := '55555555-5555-5555-5555-555555555555';
  org_b uuid := '66666666-6666-6666-6666-666666666666';
  br_a1 uuid := 'eeeeeee1-0000-0000-0000-000000000001';
  br_a2 uuid := 'eeeeeee1-0000-0000-0000-000000000002';
  br_b1 uuid := 'fffffff1-0000-0000-0000-000000000001';
  st_a_owner uuid := 'e0000000-0000-0000-0000-00000000000f';
  st_a_desk1 uuid := 'e0000000-0000-0000-0000-00000000000d';
  st_a_desk2 uuid := 'e0000000-0000-0000-0000-00000000000e';
  st_a_train uuid := 'e0000000-0000-0000-0000-00000000000a';
  st_b_owner uuid := 'f0000000-0000-0000-0000-00000000000f';

  plan_month uuid;
  member_a uuid;   -- active, with dues
  member_b uuid;   -- expiring in three days
  member_c uuid;   -- no membership at all
  member_d uuid;   -- active but has not walked in for forty days

  result jsonb;
  visit_1 uuid;
  n integer;
  txt text;
  d date;
  ts timestamptz;
  failed boolean;
  today_a date;
begin
  -- fixtures, as the owning role so RLS is out of the way --------------------
  insert into public.orgs (id, name, slug) values
    (org_a, 'Epsilon Fitness', 'epsilon-fitness-test'),
    (org_b, 'Zeta Gyms', 'zeta-gyms-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Epsilon Lazimpat'),
    (br_a2, org_a, 'Epsilon Jhamsikhel'),
    (br_b1, org_b, 'Zeta Kalanki');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_a_owner, org_a, 'Epsilon Owner',    'owner@epsilon.test', 'owner',      '{}',         'active'),
    (st_a_desk1, org_a, 'Epsilon Desk One', 'desk1@epsilon.test', 'front_desk', array[br_a1], 'active'),
    (st_a_desk2, org_a, 'Epsilon Desk Two', 'desk2@epsilon.test', 'front_desk', array[br_a2], 'active'),
    (st_a_train, org_a, 'Epsilon Trainer',  'train@epsilon.test', 'trainer',    array[br_a1], 'active'),
    (st_b_owner, org_b, 'Zeta Owner',       'owner@zeta.test',    'owner',      '{}',         'active');

  today_a := public.org_today(org_a);

  -- persona: org A owner -- builds the catalogue and the members -------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  insert into public.membership_plans
    (org_id, name, plan_type, duration_days, price_paisa)
  values (org_a, 'Monthly', 'time', 30, 250000)
  returning id into plan_month;

  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Bikash Shrestha', '9810000001', st_a_owner)
  returning id into member_a;

  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Anita Rai', '9810000002', st_a_owner)
  returning id into member_b;

  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Prakash Lama', '9810000003', st_a_owner)
  returning id into member_c;

  insert into public.members (org_id, home_branch_id, full_name, phone, created_by, joined_on)
  values (org_a, br_a1, 'Sunita Magar', '9810000004', st_a_owner, today_a - 40)
  returning id into member_d;

  -- member_a: sold a plan, paid nothing. Active, and owing money.
  result := public.renew_membership(member_a, plan_month, br_a1, today_a, 0, 0, 'cash');

  -- member_b: three days left, so the desk should be told to sell the renewal.
  insert into public.memberships
    (org_id, branch_id, member_id, plan_id, plan_name, plan_type,
     start_date, end_date, price_paisa)
  values
    (org_a, br_a1, member_b, plan_month, 'Monthly', 'time',
     today_a - 27, today_a + 3, 250000);

  -- member_d: current, but has not been seen since they joined.
  insert into public.memberships
    (org_id, branch_id, member_id, plan_id, plan_name, plan_type,
     start_date, end_date, price_paisa)
  values
    (org_a, br_a1, member_d, plan_month, 'Monthly', 'time',
     today_a - 40, today_a + 20, 250000);

  select m.status::text into txt from public.members m where m.id = member_a;
  assert txt = 'active', format('member_a should be active, was %L', txt);

  -- persona: org A front desk, branch 1 --------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk1::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  -- the ordinary check-in ----------------------------------------------------
  result := public.check_in_member(member_a, br_a1);

  assert (result ->> 'ok')::boolean, format('check-in was refused: %s', result);
  assert result ->> 'banner' = 'active',
    format('an active member got the %L banner', result ->> 'banner');
  assert (result ->> 'due_paisa')::bigint > 0,
    'the check-in did not report the outstanding dues';
  assert result #>> '{member,full_name}' = 'Bikash Shrestha',
    'the check-in returned the wrong member';
  assert result #>> '{membership,plan_name}' = 'Monthly',
    'the check-in did not name the plan';

  visit_1 := (result #>> '{attendance,id}')::uuid;

  select a.attended_on, a.is_override, a.checked_in_by::text
    into d, failed, txt
  from public.attendance a where a.id = visit_1;
  assert d = today_a, 'attended_on was not the gym business date';
  assert not failed, 'a first visit was recorded as an override';
  assert txt::uuid = st_a_desk1, 'the check-in was not attributed to the desk';

  select a.due_paisa_at_checkin into n from public.attendance a where a.id = visit_1;
  assert n > 0, 'the dues snapshot was not written';

  -- the roster ---------------------------------------------------------------
  select count(*) into n from public.in_gym_now(br_a1);
  assert n = 1, format('in_gym_now showed %s people, expected 1', n);

  select count(*) into n from public.in_gym_now(br_a2);
  assert n = 0, format('a visit at branch 1 showed up at branch 2 (%s rows)', n);

  -- the same-day rule --------------------------------------------------------
  result := public.check_in_member(member_a, br_a1);
  assert not (result ->> 'ok')::boolean, 'a second same-day check-in was accepted';
  assert result ->> 'reason' = 'already_checked_in',
    format('the second check-in gave reason %L', result ->> 'reason');
  assert result #>> '{existing,id}' = visit_1::text,
    'the duplicate response did not point at the first visit';

  -- The banner is still computed on a refused check-in: the desk needs to see
  -- the dues even when it is not writing a row.
  assert (result ->> 'due_paisa')::bigint > 0,
    'a refused check-in hid the outstanding dues';

  -- An override is a deliberate act and needs a reason.
  failed := false;
  begin
    perform public.check_in_member(member_a, br_a1, 'manual', true, null);
  exception when check_violation then failed := true;
  end;
  assert failed, 'an override was accepted with no reason';

  result := public.check_in_member(
    member_a, br_a1, 'manual', true, 'Came back after lunch'
  );
  assert (result ->> 'ok')::boolean, 'a reasoned override was refused';
  assert (result #>> '{attendance,is_override}')::boolean,
    'the override was not flagged as one';

  select count(*) into n from public.attendance a where a.member_id = member_a;
  assert n = 2, format('expected 2 visits after the override, found %s', n);

  -- A third ordinary visit still collides with the first: only overrides are
  -- allowed to stack.
  failed := false;
  begin
    insert into public.attendance (org_id, branch_id, member_id, attended_on, checked_in_by)
    values (org_a, br_a1, member_a, today_a, st_a_desk1);
  exception when unique_violation then failed := true;
  end;
  assert failed, 'a duplicate ordinary check-in was written directly';

  -- the record is evidence ---------------------------------------------------
  failed := false;
  begin
    update public.attendance set checked_in_at = now() - interval '3 hours'
    where id = visit_1;
  exception when restrict_violation then failed := true;
  end;
  assert failed, 'an arrival time was rewritten';

  failed := false;
  begin
    update public.attendance set member_id = member_b where id = visit_1;
  exception when restrict_violation then failed := true;
  end;
  assert failed, 'a visit was reassigned to another member';

  -- check-out ----------------------------------------------------------------
  result := public.check_out_member(visit_1);
  assert (result ->> 'ok')::boolean, format('check-out was refused: %s', result);

  select a.checked_out_at into ts from public.attendance a where a.id = visit_1;
  assert ts is not null, 'check-out did not stamp the row';

  result := public.check_out_member(visit_1);
  assert not (result ->> 'ok')::boolean, 'a second check-out was accepted';
  assert result ->> 'reason' = 'already_checked_out',
    format('the second check-out gave reason %L', result ->> 'reason');

  -- One visit closed, the override still open.
  select count(*) into n from public.in_gym_now(br_a1);
  assert n = 1, format('in_gym_now showed %s after one check-out, expected 1', n);

  -- the banners --------------------------------------------------------------
  result := public.check_in_member(member_b, br_a1, 'qr');
  assert result ->> 'banner' = 'expiring',
    format('a membership ending in 3 days gave the %L banner', result ->> 'banner');
  assert result #>> '{attendance,method}' = 'qr', 'the check-in method was not kept';

  result := public.check_in_member(member_c, br_a1);
  assert (result ->> 'ok')::boolean,
    'a member with no plan was not let through the door at all';
  assert result ->> 'banner' = 'none',
    format('a member with no membership gave the %L banner', result ->> 'banner');
  assert result -> 'membership' = 'null'::jsonb,
    'a member with no membership was given one';

  -- the day roll-up ----------------------------------------------------------
  select s.check_ins into n from public.attendance_day_summary(today_a, br_a1) s;
  assert n = 4, format('the day summary counted %s check-ins, expected 4', n);

  select s.distinct_members into n from public.attendance_day_summary(today_a, br_a1) s;
  assert n = 3, format('the day summary counted %s members, expected 3', n);

  -- the absence report -------------------------------------------------------
  -- member_d is active, joined forty days ago, and has never walked in.
  select a.days_absent, a.ever_visited, a.band
    into n, failed, txt
  from public.absent_members(br_a1, 14) a
  where a.member_id = member_d;

  assert n = 40, format('member_d was measured as %s days absent, expected 40', n);
  assert not failed, 'member_d was reported as having visited';
  assert txt = '30-59 days', format('member_d landed in the %L band', txt);

  -- Everyone who came in today is out of the report.
  select count(*) into n
  from public.absent_members(br_a1, 14) a
  where a.member_id in (member_a, member_b, member_c);
  assert n = 0, format('%s members who checked in today were called absent', n);

  -- A member who has not left long enough is out of it too.
  select count(*) into n from public.absent_members(br_a1, 90);
  assert n = 0, format('the 90-day report returned %s rows, expected 0', n);

  -- who may write ------------------------------------------------------------
  -- The desk at branch 2 does not work branch 1.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk2::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a2::text)
  )::text, true);
  execute 'set local role authenticated';

  -- member_d has not been in today, so this really does reach the insert and
  -- gets stopped by the policy rather than by the same-day rule.
  failed := false;
  begin
    perform public.check_in_member(member_d, br_a1);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a front desk checked a member in at a branch they do not work';

  -- Reading is org-wide on purpose: a member who trains at another branch has
  -- one history, not one per building.
  select count(*) into n from public.attendance;
  assert n = 4, format('branch 2 saw %s visits, expected the whole org history', n);

  -- Trainers mark class attendance in Phase 4, not the front door.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_train::text,
    'staff_role', 'trainer', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.check_in_member(member_d, br_a1);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a trainer wrote a front-door check-in';

  -- cross-tenant -------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.attendance;
  assert n = 0, format('org B owner leaked %s attendance rows', n);

  select count(*) into n from public.attendance_detail;
  assert n = 0, format('org B owner leaked %s rows of the visit log', n);

  select count(*) into n from public.in_gym_now();
  assert n = 0, 'the in-gym roster crossed a tenant boundary';

  select count(*) into n from public.absent_members();
  assert n = 0, 'the absence report crossed a tenant boundary';

  select count(*) into n from public.attendance_day_summary();
  assert n = 0, 'the day summary crossed a tenant boundary';

  -- Naming org A's ids does not help either.
  failed := false;
  begin
    perform public.check_in_member(member_d, br_a1);
  exception when others then failed := true;
  end;
  assert failed, 'org B checked in an org A member';

  failed := false;
  begin
    perform public.check_out_member(visit_1);
  exception when others then failed := true;
  end;
  assert failed, 'org B checked out an org A visit';

  failed := false;
  begin
    insert into public.attendance (org_id, branch_id, member_id, attended_on, checked_in_by)
    values (org_a, br_a1, member_d, today_a, st_b_owner);
  exception when others then failed := true;
  end;
  assert failed, 'org B wrote attendance into org A';

  -- claimless token ----------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  execute 'set local role authenticated';

  select count(*) into n from public.attendance;
  assert n = 0, format('a claimless token saw %s visits', n);
  select count(*) into n from public.attendance_detail;
  assert n = 0, format('a claimless token saw %s rows of the visit log', n);
  select count(*) into n from public.in_gym_now();
  assert n = 0, format('a claimless token saw %s people in the gym', n);

  -- teardown -----------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'front desk: all assertions passed';
end $$;

-- QR check-in tokens. Signed in Postgres with a key that lives in Vault and is
-- created on first use, so there is no project secret to provision by hand.
do $$
declare
  org_a uuid := '77777777-7777-7777-7777-777777777777';
  org_b uuid := '88888888-8888-8888-8888-888888888888';
  br_a1 uuid := 'aaaaaaa9-0000-0000-0000-000000000001';
  br_b1 uuid := 'bbbbbbb9-0000-0000-0000-000000000001';
  st_a_desk uuid := 'a9000000-0000-0000-0000-00000000000d';
  st_a_train uuid := 'a9000000-0000-0000-0000-00000000000a';
  st_b_owner uuid := 'b9000000-0000-0000-0000-00000000000f';

  member_a uuid;
  tok text;
  res jsonb;
  parts text[];
  failed boolean;
begin
  insert into public.orgs (id, name, slug) values
    (org_a, 'Eta Fitness', 'eta-fitness-test'),
    (org_b, 'Theta Gyms', 'theta-gyms-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Eta Main'),
    (br_b1, org_b, 'Theta Main');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_a_desk,  org_a, 'Eta Desk',    'desk@eta.test',    'front_desk', array[br_a1], 'active'),
    (st_a_train, org_a, 'Eta Trainer', 'train@eta.test',   'trainer',    array[br_a1], 'active'),
    (st_b_owner, org_b, 'Theta Owner', 'owner@theta.test', 'owner',      '{}',         'active');

  insert into public.members (org_id, home_branch_id, full_name, phone)
  values (org_a, br_a1, 'QR Tester', '9820000001')
  returning id into member_a;

  -- persona: org A front desk, issuing a printed card -------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  res := public.mint_qr_token(member_a, 120);
  tok := res ->> 'token';
  assert tok is not null, 'no token was minted';
  assert (res ->> 'member_id')::uuid = member_a, 'the token named the wrong member';
  assert (res ->> 'ttl_seconds')::int = 120, 'the ttl was not honoured';

  parts := string_to_array(tok, '.');
  assert array_length(parts, 1) = 5,
    format('token had %s parts, expected 5', array_length(parts, 1));
  assert parts[1] = 'v1', 'wrong token version';
  -- base64url, or it will not survive a URL or a QR alphabet.
  assert parts[5] !~ '[+/=]', format('signature is not base64url: %L', parts[5]);

  res := public.verify_qr_token(tok);
  assert (res ->> 'valid')::boolean, format('a fresh token failed to verify: %s', res);
  assert (res ->> 'member_id')::uuid = member_a, 'verify returned the wrong member';
  assert res ->> 'member_code' = 'M00001', 'verify did not return the member code';

  -- forgery -------------------------------------------------------------------
  res := public.verify_qr_token(
    parts[1] || '.' || parts[2] || '.' || parts[3] || '.' || parts[4] || '.AAAA'
  );
  assert res ->> 'reason' = 'bad_signature',
    format('a forged signature gave reason %L', res ->> 'reason');

  -- The expiry is inside the signature, so it cannot be extended.
  res := public.verify_qr_token(
    parts[1] || '.' || parts[2] || '.' || parts[3] || '.'
      || (parts[4]::bigint + 99999)::text || '.' || parts[5]
  );
  assert res ->> 'reason' = 'bad_signature', 'the expiry was editable';

  res := public.verify_qr_token('garbage');
  assert res ->> 'reason' = 'malformed', 'garbage was not rejected';

  res := public.verify_qr_token('v1.not-a-uuid.also-not.123.sig');
  assert res ->> 'reason' = 'malformed', 'a non-uuid token was not rejected';

  -- who may mint ---------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_train::text,
    'staff_role', 'trainer', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.mint_qr_token(member_a);
  exception when no_data_found then failed := true;
  end;
  assert failed, 'a trainer minted a QR card for a member';

  -- cross-tenant ---------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.mint_qr_token(member_a);
  exception when no_data_found then failed := true;
  end;
  assert failed, 'org B minted a token for an org A member';

  -- A genuine org A token, scanned inside org B, must not open the door: a
  -- valid signature is not authorisation.
  res := public.verify_qr_token(tok);
  assert not (res ->> 'valid')::boolean, 'an org A token verified inside org B';
  assert res ->> 'reason' = 'not_visible',
    format('a cross-tenant scan gave reason %L', res ->> 'reason');

  -- the key itself --------------------------------------------------------------
  failed := false;
  begin
    perform public.qr_signing_key();
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a signed-in user read the QR signing key';

  failed := false;
  begin
    perform count(*) from vault.decrypted_secrets;
  exception when others then failed := true;
  end;
  assert failed, 'a signed-in user read the vault';

  -- teardown ---------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'qr tokens: all assertions passed';
end $$;
