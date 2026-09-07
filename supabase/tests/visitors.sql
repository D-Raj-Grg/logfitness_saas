-- Gate for the visitor log (2026-09-08): who may log a walk-in, who may only
-- read one, the auto date, and the one-way conversion into a member.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/visitors.sql

do $$
declare
  org_a uuid := 'd1d1d1d1-1111-1111-1111-111111111111';
  org_b uuid := 'd2d2d2d2-2222-2222-2222-222222222222';
  br_a1 uuid := 'd1b10000-0000-0000-0000-000000000001';
  br_a2 uuid := 'd1b10000-0000-0000-0000-000000000002';
  br_b1 uuid := 'd2b10000-0000-0000-0000-000000000001';

  st_a_owner   uuid := 'd1c00000-0000-0000-0000-00000000000f';
  st_a_trainer uuid := 'd1c00000-0000-0000-0000-0000000000ab';
  st_a_desk    uuid := 'd1c00000-0000-0000-0000-0000000000cd';
  st_b_owner   uuid := 'd2c00000-0000-0000-0000-00000000000f';

  visitor_1 uuid;
  visitor_2 uuid;
  member_1 uuid;
  member_2 uuid;
  res jsonb;
  today_a date;
  n integer;
  status_now public.visitor_status;
  failed boolean;
begin
  insert into public.orgs (id, name, slug) values
    (org_a, 'Delta Fitness', 'delta-fitness-test'),
    (org_b, 'Echo Fitness',  'echo-fitness-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Delta One'),
    (br_a2, org_a, 'Delta Two'),
    (br_b1, org_b, 'Echo One');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_a_owner,   org_a, 'Delta Owner',   'owner@delta.test',   'owner',   '{}',         'active'),
    (st_a_trainer, org_a, 'Delta Trainer', 'trainer@delta.test', 'trainer',    array[br_a1], 'active'),
    (st_a_desk,    org_a, 'Delta Desk',    'desk@delta.test',    'front_desk', array[br_a1], 'active'),
    (st_b_owner,   org_b, 'Echo Owner',    'owner@echo.test',    'owner',   '{}',         'active');

  today_a := public.org_today(org_a);

  -- persona: org A trainer ---------------------------------------------------
  -- A walk-in asks whoever is standing there, so a trainer logs one -- but only
  -- at the branch they actually work at.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_trainer::text,
    'staff_role', 'trainer', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  insert into public.visitors (org_id, branch_id, full_name, phone, kind)
  values (org_a, br_a1, 'Walk In One', '9800000001', 'enquiry')
  returning id into visitor_1;

  -- the auto date, and the author, both filled by the trigger
  select count(*) into n
  from public.visitors
  where id = visitor_1 and visited_on = today_a and created_by = st_a_trainer;
  assert n = 1, 'visited_on or created_by was not filled from the trigger';

  failed := false;
  begin
    insert into public.visitors (org_id, branch_id, full_name, phone)
    values (org_a, br_a2, 'Wrong Branch', '9800000002');
  exception when insufficient_privilege or check_violation then failed := true;
  end;
  assert failed, 'a trainer logged a visitor at a branch they do not work at';

  failed := false;
  begin
    delete from public.visitors where id = visitor_1;
  exception when insufficient_privilege then failed := true;
  end;
  select count(*) into n from public.visitors where id = visitor_1;
  assert n = 1, 'a trainer deleted a visitor record';

  -- a trainer marks the callback they made
  update public.visitors set status = 'contacted' where id = visitor_1;
  select status into status_now from public.visitors where id = visitor_1;
  assert status_now = 'contacted', 'a trainer could not follow up a visitor';

  -- persona: org A owner -----------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  -- an owner logs anywhere, and may backdate yesterday's walk-in
  insert into public.visitors (org_id, branch_id, full_name, phone, visited_on, kind)
  values (org_a, br_a2, 'Walk In Two', '9800000002', today_a - 1, 'guest')
  returning id into visitor_2;

  select count(*) into n from public.visitors;
  assert n = 2, format('org A owner should see 2 visitors, saw %s', n);

  -- converted is not a status anyone may simply set: the check constraint
  -- requires the member the visitor became.
  failed := false;
  begin
    update public.visitors set status = 'converted' where id = visitor_2;
  exception when check_violation then failed := true;
  end;
  assert failed, 'status was set to converted with no member behind it';

  -- conversion, through the RPC, after a member exists
  res := public.register_member(
    p_full_name => 'Walk In One',
    p_phone => '9800000001',
    p_home_branch_id => br_a1
  );
  member_1 := (res ->> 'member_id')::uuid;

  perform public.convert_visitor(visitor_1, member_1);

  select status into status_now from public.visitors where id = visitor_1;
  assert status_now = 'converted', format('visitor_1 status is %s', status_now);

  select count(*) into n
  from public.visitors
  where id = visitor_1 and converted_member_id = member_1 and converted_at is not null;
  assert n = 1, 'convert_visitor did not record the member it converted into';

  -- and only once
  failed := false;
  begin
    perform public.convert_visitor(visitor_1, member_1);
  exception when check_violation then failed := true;
  end;
  assert failed, 'a visitor was converted twice';

  -- persona: org A front desk, converting a visitor logged at another branch --
  -- The desk sees the whole org's log, so it must be able to finish the job on
  -- a row from Delta Two without registering the member twice.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  res := public.register_member(
    p_full_name => 'Walk In Two',
    p_phone => '9800000002',
    p_home_branch_id => br_a1
  );
  member_2 := (res ->> 'member_id')::uuid;

  perform public.convert_visitor(visitor_2, member_2);

  select status into status_now from public.visitors where id = visitor_2;
  assert status_now = 'converted',
    format('a visitor logged at another branch was left at %s', status_now);

  -- but logging one there is still refused: a walk-in happens at a place
  failed := false;
  begin
    insert into public.visitors (org_id, branch_id, full_name, phone)
    values (org_a, br_a2, 'Wrong Branch Again', '9800000009');
  exception when insufficient_privilege or check_violation then failed := true;
  end;
  assert failed, 'the desk logged a visitor at a branch it does not work at';

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  -- the delete an owner does have
  delete from public.visitors where id = visitor_2;
  select count(*) into n from public.visitors where id = visitor_2;
  assert n = 0, 'owner could not delete a visitor record';

  -- persona: org B owner -----------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.visitors;
  assert n = 0, format('org B owner leaked %s org A visitors', n);

  failed := false;
  begin
    update public.visitors set full_name = 'Hijacked' where id = visitor_1;
  exception when others then failed := true;
  end;
  select count(*) into n from public.visitors where id = visitor_1 and full_name = 'Hijacked';
  assert n = 0, 'org B owner modified an org A visitor';

  failed := false;
  begin
    insert into public.visitors (org_id, branch_id, full_name, phone)
    values (org_a, br_a1, 'Cross Tenant', '9800000003');
  exception when insufficient_privilege or check_violation or foreign_key_violation
    then failed := true;
  end;
  assert failed, 'org B owner logged a visitor into org A';

  -- persona: a member's token, which also carries org_id ---------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', member_1::text
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.visitors;
  assert n = 0, format('a member read %s visitor rows', n);

  -- teardown -----------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'visitors: all assertions passed';
end $$;
