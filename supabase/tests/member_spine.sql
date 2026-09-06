-- Phase 1 gate: the member spine, exercised end to end, plus the cross-tenant
-- negative tests every new table owes.
--
-- Seeds two orgs, drives the real RPCs as real personas, asserts the money and
-- the isolation, then removes its fixtures. A failed assertion aborts the block.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/member_spine.sql

do $$
declare
  org_a uuid := '33333333-3333-3333-3333-333333333333';
  org_b uuid := '44444444-4444-4444-4444-444444444444';
  br_a1 uuid := 'ccccccc1-0000-0000-0000-000000000001';
  br_a2 uuid := 'ccccccc1-0000-0000-0000-000000000002';
  br_b1 uuid := 'ddddddd1-0000-0000-0000-000000000001';
  st_a_owner uuid := 'c0000000-0000-0000-0000-00000000000f';
  st_a_desk1 uuid := 'c0000000-0000-0000-0000-00000000000d';
  st_a_desk2 uuid := 'c0000000-0000-0000-0000-00000000000e';
  st_a_train uuid := 'c0000000-0000-0000-0000-00000000000a';
  st_b_owner uuid := 'd0000000-0000-0000-0000-00000000000f';

  plan_month uuid;
  plan_pt uuid;
  member_a uuid;
  member_b uuid;
  result jsonb;
  membership_1 uuid;
  invoice_1 uuid;
  payment_1 uuid;

  n integer;
  amount bigint;
  d date;
  txt text;
  failed boolean;
  today_a date;
begin
  -- fixtures, as the owning role so RLS is out of the way -------------------
  insert into public.orgs (id, name, slug) values
    (org_a, 'Gamma Fitness', 'gamma-fitness-test'),
    (org_b, 'Delta Gyms', 'delta-gyms-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Gamma Thamel'),
    (br_a2, org_a, 'Gamma Patan'),
    (br_b1, org_b, 'Delta Baneshwor');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_a_owner, org_a, 'Gamma Owner',   'owner@gamma.test',  'owner',      '{}',          'active'),
    (st_a_desk1, org_a, 'Gamma Desk One','desk1@gamma.test',  'front_desk', array[br_a1],  'active'),
    (st_a_desk2, org_a, 'Gamma Desk Two','desk2@gamma.test',  'front_desk', array[br_a2],  'active'),
    (st_a_train, org_a, 'Gamma Trainer', 'train@gamma.test',  'trainer',    array[br_a1],  'active'),
    (st_b_owner, org_b, 'Delta Owner',   'owner@delta.test',  'owner',      '{}',          'active');

  today_a := public.org_today(org_a);

  -- persona: org A owner -- builds the catalogue ----------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  insert into public.membership_plans
    (org_id, name, plan_type, duration_days, price_paisa, signup_fee_paisa)
  values
    (org_a, 'Monthly', 'time', 30, 250000, 50000)
  returning id into plan_month;

  insert into public.membership_plans
    (org_id, name, plan_type, session_count, price_paisa, branch_ids)
  values
    (org_a, 'PT 10 Pack', 'session_pack', 10, 1500000, array[br_a1])
  returning id into plan_pt;

  -- A time plan without a duration, or a pack without a count, is not a plan.
  failed := false;
  begin
    insert into public.membership_plans (org_id, name, plan_type, price_paisa)
    values (org_a, 'Nonsense', 'time', 100);
  exception when check_violation then failed := true;
  end;
  assert failed, 'a time plan was accepted with no duration';

  -- persona: org A front desk, branch 1 -------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk1::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  -- registration -----------------------------------------------------------
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, '  Raj Bahadur ', '9800000001', st_a_desk1)
  returning id into member_a;

  select m.full_name into txt from public.members m where m.id = member_a;
  assert txt = 'Raj Bahadur', format('name was not trimmed: %L', txt);

  select m.member_code into txt from public.members m where m.id = member_a;
  assert txt = 'M00001', format('first member code was %L, expected M00001', txt);

  select m.status::text into txt from public.members m where m.id = member_a;
  assert txt = 'expired', format('a member with no membership should be expired, was %L', txt);

  select m.joined_on into d from public.members m where m.id = member_a;
  assert d = today_a, 'joined_on was not defaulted to the org business date';

  -- Phone is the identity anchor: one per org.
  failed := false;
  begin
    insert into public.members (org_id, home_branch_id, full_name, phone)
    values (org_a, br_a1, 'Duplicate', '9800000001');
  exception when unique_violation then failed := true;
  end;
  assert failed, 'a duplicate phone was accepted within one org';

  -- ...but the same number in another chain is a different person.
  -- (checked from org B's persona further down)

  -- Front desk cannot register into a branch they do not work.
  failed := false;
  begin
    insert into public.members (org_id, home_branch_id, full_name, phone)
    values (org_a, br_a2, 'Wrong Branch', '9800000009');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'front desk registered a member at another branch';

  -- selling a membership ----------------------------------------------------
  result := public.renew_membership(
    p_member_id := member_a,
    p_plan_id := plan_month,
    p_branch_id := br_a1,
    p_discount_paisa := 0,
    p_amount_paid_paisa := 200000,
    p_method := 'cash'
  );

  membership_1 := (result ->> 'membership_id')::uuid;
  invoice_1 := (result ->> 'invoice_id')::uuid;
  payment_1 := (result ->> 'payment_id')::uuid;

  assert membership_1 is not null, 'renewal returned no membership';
  assert (result ->> 'invoice_no') = 'INV000001',
    format('first invoice number was %L', result ->> 'invoice_no');

  -- Price is the plan plus the one-time joining fee: 2500 + 500 rupees.
  select i.total_paisa into amount from public.invoices i where i.id = invoice_1;
  assert amount = 300000, format('invoice total was %s paisa, expected 300000', amount);

  -- The fee is also recorded on its own, so a printed invoice can name it.
  select ms.signup_fee_paisa into amount
  from public.memberships ms where ms.id = membership_1;
  assert amount = 50000, format('joining fee was stored as %s, expected 50000', amount);

  select i.due_paisa into amount from public.invoices i where i.id = invoice_1;
  assert amount = 100000, format('due was %s paisa, expected 100000', amount);

  select i.status::text into txt from public.invoices i where i.id = invoice_1;
  assert txt = 'partial', format('invoice status was %L, expected partial', txt);

  -- A 30-day plan bought today runs through day 30, not day 31.
  select ms.end_date into d from public.memberships ms where ms.id = membership_1;
  assert d = today_a + 29, format('end date was %s, expected %s', d, today_a + 29);

  select m.status::text into txt from public.members m where m.id = member_a;
  assert txt = 'active', format('member should be active after a renewal, was %L', txt);

  -- the arrears report sees the shortfall ----------------------------------
  select count(*) into n from public.arrears_report() r where r.member_id = member_a;
  assert n = 1, 'the part-paid member is missing from arrears';

  select r.bucket into txt from public.arrears_report() r where r.member_id = member_a;
  assert txt = '0-30', format('a same-day debt landed in bucket %L', txt);

  -- the daily collection sheet sees the cash -------------------------------
  select sum(c.amount_paisa) into amount from public.daily_collection() c;
  assert amount = 200000, format('collection sheet totalled %s, expected 200000', amount);

  -- settling the balance ----------------------------------------------------
  result := public.record_payment(invoice_1, 100000, 'esewa', 'ESW-1234');

  assert (result ->> 'status') = 'paid',
    format('invoice did not settle: %L', result ->> 'status');
  assert (result ->> 'due_paisa') = '0', 'a settled invoice still shows a balance';

  -- Overpayment is refused rather than silently absorbed.
  failed := false;
  begin
    perform public.record_payment(invoice_1, 100, 'cash');
  exception when check_violation then failed := true;
  end;
  assert failed, 'the invoice accepted more than it was owed';

  -- A digital payment with no reference cannot be reconciled.
  failed := false;
  begin
    insert into public.payments (org_id, branch_id, member_id, amount_paisa, method, collected_by)
    values (org_a, br_a1, member_a, 100, 'khalti', st_a_desk1);
  exception when check_violation then failed := true;
  end;
  assert failed, 'a khalti payment was accepted with no reference number';

  -- payments are immutable --------------------------------------------------
  -- There is no update or delete policy on payments at all, so for ordinary
  -- staff RLS makes the row invisible to the write and nothing moves.
  update public.payments set amount_paisa = 1 where id = payment_1;
  select p.amount_paisa into amount from public.payments p where p.id = payment_1;
  assert amount = 200000, format('a payment was edited: it now reads %s', amount);

  delete from public.payments where id = payment_1;
  select count(*) into n from public.payments p where p.id = payment_1;
  assert n = 1, 'a payment was deleted';

  -- ...and the triggers catch a caller who is past RLS entirely.
  execute 'reset role';

  failed := false;
  begin
    update public.payments set amount_paisa = 1 where id = payment_1;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'the payment immutability trigger did not fire for a privileged caller';

  failed := false;
  begin
    delete from public.payments where id = payment_1;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'the payment delete guard did not fire for a privileged caller';

  execute 'set local role authenticated';

  -- refunds walk the invoice back down --------------------------------------
  result := public.refund_payment(payment_1, 50000, 'Sold the wrong plan');

  select i.due_paisa into amount from public.invoices i where i.id = invoice_1;
  assert amount = 50000, format('after a 500 refund the invoice owed %s', amount);

  select i.status::text into txt from public.invoices i where i.id = invoice_1;
  assert txt = 'partial', format('a refunded invoice reads %L', txt);

  select count(*) into n
  from public.payments p
  where p.invoice_id = invoice_1 and p.kind = 'refund' and p.amount_paisa = -50000;
  assert n = 1, 'the refund was not stored as a negative row';

  -- A refund still has to say why.
  failed := false;
  begin
    perform public.refund_payment(payment_1, 100, '   ');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a refund was accepted with no reason';

  -- membership history is append-only ---------------------------------------
  failed := false;
  begin
    update public.memberships set price_paisa = 1 where id = membership_1;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a membership price was rewritten';

  delete from public.memberships where id = membership_1;
  select count(*) into n from public.memberships ms where ms.id = membership_1;
  assert n = 1, 'a membership was deleted';

  execute 'reset role';
  failed := false;
  begin
    delete from public.memberships where id = membership_1;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'the membership delete guard did not fire for a privileged caller';
  execute 'set local role authenticated';

  -- freeze and unfreeze ------------------------------------------------------
  perform public.freeze_membership(membership_1, 'Travelling');

  select m.status::text into txt from public.members m where m.id = member_a;
  assert txt = 'frozen', format('a frozen membership left the member %L', txt);

  -- Backdate the freeze so unfreezing has days to give back.
  execute 'reset role';
  update public.memberships set frozen_on = today_a - 5 where id = membership_1;
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk1::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  result := public.unfreeze_membership(membership_1);
  assert (result ->> 'paused_days') = '5',
    format('unfreeze credited %L days, expected 5', result ->> 'paused_days');

  select ms.end_date into d from public.memberships ms where ms.id = membership_1;
  assert d = today_a + 34, format('end date after unfreeze was %s, expected %s', d, today_a + 34);

  select m.status::text into txt from public.members m where m.id = member_a;
  assert txt = 'active', 'unfreezing did not restore the member';

  -- a renewal queues behind the current membership ---------------------------
  result := public.renew_membership(
    p_member_id := member_a,
    p_plan_id := plan_month,
    p_branch_id := br_a1,
    p_amount_paid_paisa := 250000
  );

  select ms.start_date into d
  from public.memberships ms where ms.id = (result ->> 'membership_id')::uuid;
  assert d = today_a + 35, format('the renewal started %s, expected %s', d, today_a + 35);

  select ms.status::text into txt
  from public.memberships ms where ms.id = (result ->> 'membership_id')::uuid;
  assert txt = 'upcoming', format('a future-dated renewal reads %L', txt);

  -- The joining fee is charged once.
  select i.total_paisa into amount
  from public.invoices i where i.id = (result ->> 'invoice_id')::uuid;
  assert amount = 250000, format('the renewal re-charged a joining fee: %s', amount);

  select ms.signup_fee_paisa into amount
  from public.memberships ms where ms.id = (result ->> 'membership_id')::uuid;
  assert amount = 0, format('the renewal recorded a joining fee of %s', amount);

  -- a plan that is not sold at this branch cannot be sold at this branch ------
  failed := false;
  begin
    perform public.renew_membership(
      p_member_id := member_a,
      p_plan_id := plan_pt,
      p_branch_id := br_a2
    );
  exception when check_violation or insufficient_privilege then failed := true;
  end;
  assert failed, 'a branch-scoped plan was sold at the wrong branch';

  -- session packs ------------------------------------------------------------
  insert into public.members (org_id, home_branch_id, full_name, phone)
  values (org_a, br_a1, 'Sita Gurung', '9800000002')
  returning id into member_b;

  result := public.renew_membership(
    p_member_id := member_b,
    p_plan_id := plan_pt,
    p_branch_id := br_a1,
    p_amount_paid_paisa := 1500000
  );

  select ms.sessions_remaining into n
  from public.memberships ms where ms.id = (result ->> 'membership_id')::uuid;
  assert n = 10, format('the pack opened with %s sessions', n);

  select m.status::text into txt from public.members m where m.id = member_b;
  assert txt = 'active', 'a session pack did not activate the member';

  -- Burning the last session ends the entitlement.
  update public.memberships set sessions_remaining = 0
  where id = (result ->> 'membership_id')::uuid;

  select m.status::text into txt from public.members m where m.id = member_b;
  assert txt = 'expired', format('an empty pack left the member %L', txt);

  -- trainers do not touch members or money -----------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_train::text,
    'staff_role', 'trainer', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.members;
  assert n = 2, format('a trainer should read the member list, saw %s', n);

  failed := false;
  begin
    insert into public.members (org_id, home_branch_id, full_name, phone)
    values (org_a, br_a1, 'Trainer Reg', '9800000003');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a trainer registered a member';

  failed := false;
  begin
    perform public.renew_membership(member_a, plan_month, br_a1);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a trainer sold a membership';

  -- a front desk sees only their own branch's cash ---------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk2::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a2::text)
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.payments;
  assert n = 0, format('branch 2 front desk read %s of branch 1 payments', n);

  -- ...but the member list stays org-wide, so a visitor is found not re-created
  select count(*) into n from public.members;
  assert n = 2, format('branch 2 front desk saw %s members, expected the whole org', n);

  -- CROSS-TENANT -------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.members;
  assert n = 0, format('org B owner leaked %s org A members', n);

  select count(*) into n from public.membership_plans;
  assert n = 0, format('org B owner leaked %s org A plans', n);

  select count(*) into n from public.memberships;
  assert n = 0, format('org B owner leaked %s org A memberships', n);

  select count(*) into n from public.invoices;
  assert n = 0, format('org B owner leaked %s org A invoices', n);

  select count(*) into n from public.payments;
  assert n = 0, format('org B owner leaked %s org A payments', n);

  select count(*) into n from public.member_overview;
  assert n = 0, format('org B owner leaked %s rows of the member overview', n);

  select count(*) into n from public.arrears_report();
  assert n = 0, 'the arrears report crossed a tenant boundary';

  select count(*) into n from public.daily_collection();
  assert n = 0, 'the collection sheet crossed a tenant boundary';

  -- Cannot reach into org A by naming its ids either.
  failed := false;
  begin
    perform public.renew_membership(member_a, plan_month, br_a1);
  exception when others then failed := true;
  end;
  assert failed, 'org B sold a membership to an org A member';

  failed := false;
  begin
    perform public.record_payment(invoice_1, 100, 'cash');
  exception when others then failed := true;
  end;
  assert failed, 'org B paid an org A invoice';

  failed := false;
  begin
    insert into public.members (org_id, home_branch_id, full_name, phone)
    values (org_a, br_a1, 'Cross Tenant', '9800000004');
  exception when others then failed := true;
  end;
  assert failed, 'org B wrote a member into org A';

  -- The same phone number in a different chain is a different person.
  insert into public.members (org_id, home_branch_id, full_name, phone)
  values (org_b, br_b1, 'Delta Member', '9800000001');

  select count(*) into n from public.members;
  assert n = 1, format('org B should see only its own member, saw %s', n);

  -- claimless token ----------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  execute 'set local role authenticated';

  select count(*) into n from public.members;
  assert n = 0, format('a claimless token saw %s members', n);
  select count(*) into n from public.payments;
  assert n = 0, format('a claimless token saw %s payments', n);
  select count(*) into n from public.invoices;
  assert n = 0, format('a claimless token saw %s invoices', n);
  select count(*) into n from public.membership_plans;
  assert n = 0, format('a claimless token saw %s plans', n);

  -- teardown -----------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'member spine: all assertions passed';
end $$;
