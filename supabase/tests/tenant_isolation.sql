-- Cross-tenant isolation gate.
--
-- Run against any environment before release. It seeds two orgs, impersonates
-- staff personas by setting the JWT claims RLS reads, asserts that no persona
-- can see or touch the other tenant, and rolls its fixtures back at the end.
-- A failed assertion aborts the whole block, so nothing is left behind.
--
--   psql "$SUPABASE_DB_URL" -f supabase/tests/tenant_isolation.sql
--
-- Every new table added to the schema must gain assertions here.

do $$
declare
  org_a uuid := '11111111-1111-1111-1111-111111111111';
  org_b uuid := '22222222-2222-2222-2222-222222222222';
  br_a1 uuid := 'aaaaaaa1-0000-0000-0000-000000000001';
  br_a2 uuid := 'aaaaaaa1-0000-0000-0000-000000000002';
  br_b1 uuid := 'bbbbbbb1-0000-0000-0000-000000000001';
  st_a_owner uuid := 'a0000000-0000-0000-0000-00000000000f';
  st_a_desk  uuid := 'a0000000-0000-0000-0000-00000000000d';
  st_a_mgr   uuid := 'a0000000-0000-0000-0000-00000000000c';
  st_b_owner uuid := 'b0000000-0000-0000-0000-00000000000f';
  n integer;
  failed boolean;
begin
  -- fixtures (as the owning role, so RLS is bypassed here on purpose) --------
  insert into public.orgs (id, name, slug) values
    (org_a, 'Alpha Fitness', 'alpha-fitness-test'),
    (org_b, 'Beta Gyms', 'beta-gyms-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Alpha Thamel'),
    (br_a2, org_a, 'Alpha Patan'),
    (br_b1, org_b, 'Beta Baneshwor');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_a_owner, org_a, 'Alpha Owner', 'owner@alpha.test', 'owner', '{}', 'active'),
    (st_a_desk,  org_a, 'Alpha Desk',  'desk@alpha.test',  'front_desk', array[br_a1], 'active'),
    (st_a_mgr,   org_a, 'Alpha Manager', 'mgr@alpha.test',  'manager', array[br_a1], 'active'),
    (st_b_owner, org_b, 'Beta Owner',  'owner@beta.test',  'owner', '{}', 'active');

  -- persona: org A front desk ----------------------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.orgs;
  assert n = 1, format('front_desk should see exactly 1 org, saw %s', n);

  select count(*) into n from public.orgs where id = org_b;
  assert n = 0, 'front_desk leaked org B';

  select count(*) into n from public.branches;
  assert n = 2, format('front_desk should see 2 branches of own org, saw %s', n);

  select count(*) into n from public.branches where org_id = org_b;
  assert n = 0, 'front_desk leaked org B branches';

  select count(*) into n from public.staff;
  assert n = 3, format('front_desk should see 3 colleagues, saw %s', n);

  select count(*) into n from public.staff where org_id = org_b;
  assert n = 0, 'front_desk leaked org B staff';

  select count(*) into n from public.audit_log;
  assert n = 0, format('front_desk must not read the audit log, saw %s rows', n);

  failed := false;
  begin
    insert into public.branches (org_id, name) values (org_a, 'Rogue Branch');
  exception when insufficient_privilege or check_violation then failed := true;
  end;
  assert failed, 'front_desk was able to insert a branch';

  failed := false;
  begin
    update public.staff set role = 'owner' where id = st_a_desk;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'front_desk escalated its own role';

  -- persona: org B owner ----------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.branches;
  assert n = 1, format('org B owner should see 1 branch, saw %s', n);

  select count(*) into n from public.staff where org_id = org_a;
  assert n = 0, 'org B owner leaked org A staff';

  failed := false;
  begin
    update public.orgs set name = 'Hijacked' where id = org_a;
  exception when others then failed := true;
  end;
  select count(*) into n from public.orgs where id = org_a and name = 'Hijacked';
  assert n = 0, 'org B owner modified org A';

  -- persona: org A manager --------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_mgr::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  -- a manager staffs their own floor, and nothing above it
  failed := false;
  begin
    insert into public.staff (org_id, full_name, email, role, branch_ids, status)
    values (org_a, 'Rogue Owner', 'rogue-owner@alpha.test', 'owner', '{}', 'invited');
  exception when others then failed := true;
  end;
  assert failed, 'manager invited an owner';

  failed := false;
  begin
    insert into public.staff (org_id, full_name, email, role, branch_ids, status)
    values (org_a, 'Rogue Manager', 'rogue-mgr@alpha.test', 'manager', array[br_a1], 'invited');
  exception when others then failed := true;
  end;
  assert failed, 'manager invited a peer manager';

  -- ...and only into branches they actually run
  failed := false;
  begin
    insert into public.staff (org_id, full_name, email, role, branch_ids, status)
    values (org_a, 'Wrong Branch', 'wrong-branch@alpha.test', 'trainer', array[br_a2], 'invited');
  exception when others then failed := true;
  end;
  assert failed, 'manager invited into a branch they do not run';

  insert into public.staff (org_id, full_name, email, role, branch_ids, status)
  values (org_a, 'Good Hire', 'hire@alpha.test', 'front_desk', array[br_a1], 'invited');

  select count(*) into n from public.staff where email = 'hire@alpha.test';
  assert n = 1, 'manager could not invite front desk into their own branch';

  failed := false;
  begin
    update public.staff set status = 'inactive' where id = st_a_owner;
  exception when others then failed := true;
  end;
  select count(*) into n
  from public.staff
  where id = st_a_owner and status = 'active'::public.staff_status;
  assert n = 1, 'manager deactivated an owner';

  -- persona: authenticated but with no tenant claims ------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  execute 'set local role authenticated';

  select count(*) into n from public.orgs;
  assert n = 0, format('claimless token saw %s orgs', n);
  select count(*) into n from public.branches;
  assert n = 0, format('claimless token saw %s branches', n);
  select count(*) into n from public.staff;
  assert n = 0, format('claimless token saw %s staff', n);

  -- teardown ----------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'tenant isolation: all assertions passed';
end $$;
