-- Gate for register_member(): the one-submit registration, the atomicity that
-- makes it safe, and the widened plan-creation rule for the front desk.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/register_member.sql

do $$
declare
  org_a uuid := 'a1a1a1a1-1111-1111-1111-111111111111';
  org_b uuid := 'b1b1b1b1-1111-1111-1111-111111111111';
  br_a1 uuid := 'a1b10000-0000-0000-0000-000000000001';
  br_a2 uuid := 'a1b10000-0000-0000-0000-000000000002';
  br_b1 uuid := 'b1b10000-0000-0000-0000-000000000001';
  st_a_owner uuid := 'a1c00000-0000-0000-0000-00000000000f';
  st_a_desk  uuid := 'a1c00000-0000-0000-0000-00000000000d';
  st_a_train uuid := 'a1c00000-0000-0000-0000-00000000000a';
  st_b_owner uuid := 'b1c00000-0000-0000-0000-00000000000f';

  plan_month uuid;
  plan_other uuid;
  res jsonb;
  member_1 uuid;
  n integer;
  txt text;
  failed boolean;
  today_a date;

  procedure_note text;
begin
  insert into public.orgs (id, name, slug) values
    (org_a, 'Kappa Fitness', 'kappa-fitness-test'),
    (org_b, 'Lambda Gyms', 'lambda-gyms-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Kappa One'),
    (br_a2, org_a, 'Kappa Two'),
    (br_b1, org_b, 'Lambda One');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_a_owner, org_a, 'Kappa Owner',   'owner@kappa.test',  'owner',      '{}',         'active'),
    (st_a_desk,  org_a, 'Kappa Desk',    'desk@kappa.test',   'front_desk', array[br_a1], 'active'),
    (st_a_train, org_a, 'Kappa Trainer', 'train@kappa.test',  'trainer',    array[br_a1], 'active'),
    (st_b_owner, org_b, 'Lambda Owner',  'owner@lambda.test', 'owner',      '{}',         'active');

  today_a := public.org_today(org_a);

  -- persona: org A owner, seeding the catalogue --------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  insert into public.membership_plans
    (org_id, name, plan_type, duration_days, price_paisa, signup_fee_paisa, branch_ids)
  values (org_a, 'Monthly', 'time', 30, 250000, 50000, array[br_a1])
  returning id into plan_month;

  -- Sold only at branch two, so branch one must refuse it.
  insert into public.membership_plans
    (org_id, name, plan_type, duration_days, price_paisa, branch_ids)
  values (org_a, 'Two Only', 'time', 30, 100000, array[br_a2])
  returning id into plan_other;

  -- persona: org A front desk, branch one --------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  -- register only, no plan -----------------------------------------------------
  res := public.register_member('  Hari Thapa  ', '9850000001', br_a1);

  member_1 := (res ->> 'member_id')::uuid;
  assert member_1 is not null, 'register_member returned no member id';
  assert res ->> 'member_code' = 'M00001',
    format('first member code was %L', res ->> 'member_code');
  assert (res ->> 'sold')::boolean is false, 'a sale happened with no plan given';
  assert not (res ? 'invoice_no'), 'an invoice was raised with no plan given';

  select m.full_name, m.status::text into txt, procedure_note
  from public.members m where m.id = member_1;
  assert txt = 'Hari Thapa', format('name was not trimmed: %L', txt);
  assert procedure_note = 'expired',
    format('a member with no plan should be expired, was %L', procedure_note);

  select m.created_by into txt from public.members m where m.id = member_1;
  assert txt::uuid = st_a_desk, 'the registration was not attributed to the desk';

  -- register and sell in one call ----------------------------------------------
  res := public.register_member(
    'Gita Rai', '9850000002', br_a1, null, null, null, null, null, null, null,
    plan_month, 0, 200000, 'cash', null
  );

  assert (res ->> 'sold')::boolean, 'the plan was not sold';
  assert res ->> 'invoice_no' is not null, 'no invoice was raised';

  select m.status::text into txt
  from public.members m where m.id = (res ->> 'member_id')::uuid;
  assert txt = 'active', format('a member who bought a plan was %L', txt);

  -- Price 2500 + 500 joining fee = 3000, of which 2000 was paid.
  assert (res ->> 'total_paisa')::bigint = 300000,
    format('total was %s, expected 300000', res ->> 'total_paisa');
  assert (res ->> 'due_paisa')::bigint = 100000,
    format('due was %s, expected 100000', res ->> 'due_paisa');

  select count(*) into n from public.memberships ms
  where ms.member_id = (res ->> 'member_id')::uuid;
  assert n = 1, format('expected 1 membership, found %s', n);

  select count(*) into n from public.payments p
  where p.member_id = (res ->> 'member_id')::uuid;
  assert n = 1, format('expected 1 payment, found %s', n);

  -- atomicity ------------------------------------------------------------------
  -- A rejected sale must leave nothing behind, or the desk resubmits into a
  -- unique-phone error with a half-registered member already saved.
  failed := false;
  begin
    perform public.register_member(
      'Ghost One', '9850000003', br_a1, null, null, null, null, null, null, null,
      plan_month, 999999999, 0, 'cash', null      -- discount above the price
    );
  exception when check_violation then failed := true;
  end;
  assert failed, 'a discount above the price was accepted';

  select count(*) into n from public.members m where m.phone = '9850000003';
  assert n = 0, format('a rejected sale left %s orphan members behind', n);

  failed := false;
  begin
    perform public.register_member(
      'Ghost Two', '9850000004', br_a1, null, null, null, null, null, null, null,
      plan_other, 0, 0, 'cash', null              -- plan not sold at branch one
    );
  exception when check_violation then failed := true;
  end;
  assert failed, 'a plan not sold at this branch was accepted';

  select count(*) into n from public.members m where m.phone = '9850000004';
  assert n = 0, format('a wrong-branch sale left %s orphan members behind', n);

  -- Overpaying is refused too, and again leaves nothing.
  failed := false;
  begin
    perform public.register_member(
      'Ghost Three', '9850000005', br_a1, null, null, null, null, null, null, null,
      plan_month, 0, 900000, 'cash', null
    );
  exception when check_violation then failed := true;
  end;
  assert failed, 'a payment above the amount due was accepted';

  select count(*) into n from public.members m where m.phone = '9850000005';
  assert n = 0, format('an overpayment left %s orphan members behind', n);

  -- Money with no plan to land against would simply vanish.
  failed := false;
  begin
    perform public.register_member(
      'Ghost Four', '9850000009', br_a1, null, null, null, null, null, null, null,
      null, 0, 50000, 'cash', null
    );
  exception when check_violation then failed := true;
  end;
  assert failed, 'payment was taken with no plan to put it against';

  select count(*) into n from public.members m where m.phone = '9850000009';
  assert n = 0, format('payment with no plan left %s members behind', n);

  -- the hint channel ------------------------------------------------------------
  -- The Server Action decides which field a message lands on from this hint, so
  -- it is part of the contract, not a debugging aid.
  procedure_note := null;
  begin
    perform public.register_member(
      'Hint Sale', '9850000010', br_a1, null, null, null, null, null, null, null,
      plan_other, 0, 0, 'cash', null
    );
  exception when others then
    get stacked diagnostics procedure_note = pg_exception_hint;
  end;
  assert procedure_note = 'sale',
    format('a sale failure was hinted %L, expected ''sale''', procedure_note);

  procedure_note := null;
  begin
    -- Gita's phone, already taken.
    perform public.register_member('Hint Member', '9850000002', br_a1);
  exception when others then
    get stacked diagnostics procedure_note = pg_exception_hint;
  end;
  assert procedure_note = 'member',
    format('a duplicate phone was hinted %L, expected ''member''', procedure_note);

  -- the desk cannot register into a branch it does not work --------------------
  failed := false;
  begin
    perform public.register_member('Wrong Branch', '9850000006', br_a2);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'the desk registered into a branch it does not work';

  procedure_note := null;
  begin
    perform public.register_member('Wrong Branch', '9850000011', br_a2);
  exception when others then
    get stacked diagnostics procedure_note = pg_exception_hint;
  end;
  assert procedure_note = 'member',
    format('a branch refusal was hinted %L, expected ''member''', procedure_note);

  -- front desk adds a plan, scoped to its own branch ---------------------------
  insert into public.membership_plans
    (org_id, name, plan_type, duration_days, price_paisa, branch_ids)
  values (org_a, 'Desk Special', 'time', 15, 120000, array[br_a1]);

  select count(*) into n from public.membership_plans p
  where p.org_id = org_a and p.name = 'Desk Special';
  assert n = 1, 'the front desk could not add a plan for its own branch';

  -- ...but not an org-wide one, and not one for someone else's branch.
  failed := false;
  begin
    insert into public.membership_plans
      (org_id, name, plan_type, duration_days, price_paisa)
    values (org_a, 'Chain Wide', 'time', 30, 100000);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'the front desk priced the whole chain';

  failed := false;
  begin
    insert into public.membership_plans
      (org_id, name, plan_type, duration_days, price_paisa, branch_ids)
    values (org_a, 'Other Branch', 'time', 30, 100000, array[br_a2]);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'the front desk priced a branch it does not work';

  failed := false;
  begin
    insert into public.membership_plans
      (org_id, name, plan_type, duration_days, price_paisa, branch_ids)
    values (org_a, 'Both Branches', 'time', 30, 100000, array[br_a1, br_a2]);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'the front desk priced a branch set it does not fully work';

  -- trainers still cannot register or price ------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_train::text,
    'staff_role', 'trainer', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.register_member('By Trainer', '9850000007', br_a1);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a trainer registered a member';

  failed := false;
  begin
    insert into public.membership_plans
      (org_id, name, plan_type, duration_days, price_paisa, branch_ids)
    values (org_a, 'By Trainer', 'time', 30, 100000, array[br_a1]);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a trainer added a plan';

  -- owners keep org-wide pricing ------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  insert into public.membership_plans
    (org_id, name, plan_type, duration_days, price_paisa)
  values (org_a, 'Chain Wide', 'time', 30, 100000);

  select count(*) into n from public.membership_plans p
  where p.org_id = org_a and p.name = 'Chain Wide';
  assert n = 1, 'an owner could not price the whole chain';

  -- cross-tenant -----------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.membership_plans;
  assert n = 0, format('org B saw %s of org A''s plans', n);

  -- Naming org A's branch does not register into org A: jwt_org_id() is org B,
  -- so the composite branch foreign key has nothing to point at.
  -- org_id is taken from org B's own claims, so the row it tries to write is
  -- (org_b, <an org A branch>) -- a pair that does not exist in branches. That
  -- is caught by members_home_branch_fkey, which is DEFERRABLE INITIALLY
  -- DEFERRED, so the refusal lands at commit rather than at the insert. In the
  -- app each Server Action is its own transaction and the caller sees the
  -- error; here the check has to be pulled forward to be observed at all.
  failed := false;
  begin
    perform public.register_member('Cross Tenant', '9850000008', br_a1);
    set constraints all immediate;
  exception when others then failed := true;
  end;
  assert failed, 'org B registered a member into org A';

  select count(*) into n from public.members m where m.phone = '9850000008';
  assert n = 0, format('a cross-tenant registration left %s members behind', n);

  -- teardown ----------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'register member: all assertions passed';
end $$;
