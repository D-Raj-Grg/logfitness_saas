-- Gate for the fees catalogue (20261027100000..100200): what a sale charges,
-- what it records, who may change the catalogue, and that a recorded sale never
-- moves. renew_membership and sale_fees are the contract; the web console and
-- the Flutter app mirror them, so a failure here is a failure in all three.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/fees.sql

create or replace function pg_temp.act_as(
  p_org uuid, p_staff uuid, p_role text, p_branches uuid[] default '{}'
) returns void language plpgsql as $f$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', p_org::text, 'staff_id', p_staff::text, 'staff_role', p_role,
    'branch_ids', to_json(p_branches)
  )::text, true);
  execute 'set local role authenticated';
end;
$f$;

do $$
declare
  org_a uuid := 'f1e10000-0000-0000-0000-00000000000a';
  org_b uuid := 'f1e10000-0000-0000-0000-00000000000b';
  br_a  uuid := 'f1b10000-0000-0000-0000-00000000000a';
  br_b  uuid := 'f1b10000-0000-0000-0000-00000000000b';
  st_own  uuid := 'f1c00000-0000-0000-0000-000000000001';
  st_mgr  uuid := 'f1c00000-0000-0000-0000-000000000002';
  st_desk uuid := 'f1c00000-0000-0000-0000-000000000003';
  st_b    uuid := 'f1c00000-0000-0000-0000-0000000000bb';
  plan_x uuid := 'f1d00000-0000-0000-0000-000000000001';
  plan_y uuid := 'f1d00000-0000-0000-0000-000000000002';
  plan_z uuid := 'f1d00000-0000-0000-0000-000000000003';
  plan_w uuid := 'f1d00000-0000-0000-0000-000000000004';
  plan_b uuid := 'f1d00000-0000-0000-0000-0000000000bb';
  fee_reg uuid; fee_card uuid; fee_locker uuid; fee_b uuid;
  m_a uuid; m_b uuid; m_c uuid; m_d uuid; m_e uuid; m_f uuid;
  n int; amount bigint; sub bigint; txt text;
begin
  -- fixtures, as the table owner ------------------------------------------------
  insert into public.orgs (id, name, slug, fee_catalogue_enabled) values
    (org_a, 'Fees Gym A', 'fees-gym-a-test', true),
    (org_b, 'Fees Gym B', 'fees-gym-b-test', true);
  insert into public.branches (id, org_id, name) values
    (br_a, org_a, 'A One'), (br_b, org_b, 'B One');
  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_own,  org_a, 'Fees Owner',  'owner@fees-a.test',   'owner',      '{}',        'active'),
    (st_mgr,  org_a, 'Fees Mgr',    'mgr@fees-a.test',     'manager',    array[br_a], 'active'),
    (st_desk, org_a, 'Fees Desk',   'desk@fees-a.test',    'front_desk', array[br_a], 'active'),
    (st_b,    org_b, 'B Owner',     'owner@fees-b.test',   'owner',      '{}',        'active');
  insert into public.membership_plans
    (id, org_id, name, plan_type, duration_days, price_paisa, signup_fee_paisa, branch_ids)
  values
    (plan_x, org_a, 'Plan X', 'time', 30, 100000, 0, array[br_a]),
    (plan_y, org_a, 'Plan Y', 'time', 30,  50000, 0, array[br_a]),
    (plan_b, org_b, 'Plan B', 'time', 30,  70000, 0, array[br_b]);

  -- 1. the owner builds the catalogue -------------------------------------------
  perform pg_temp.act_as(org_a, st_own, 'owner');

  insert into public.fees (org_id, name, charge_rule, amount_paisa, plan_ids, sort_order)
  values (org_a, '  Registration fee ', 'once', 50000, array[plan_x, plan_x], 0)
  returning id into fee_reg;
  insert into public.fees (org_id, name, charge_rule, amount_paisa, all_plans, plan_ids, sort_order)
  values (org_a, 'Card fee', 'once', 20000, true, array[plan_x], 1)
  returning id into fee_card;
  insert into public.fees (org_id, name, charge_rule, amount_paisa, plan_ids, sort_order)
  values (org_a, 'Locker', 'every_sale', 10000, array[plan_x], 2)
  returning id into fee_locker;

  select name into txt from public.fees where id = fee_reg;
  assert txt = 'Registration fee', format('name was not trimmed: [%s]', txt);
  select cardinality(plan_ids) into n from public.fees where id = fee_reg;
  assert n = 1, format('a plan listed twice kept %s entries, expected 1', n);
  select cardinality(plan_ids) into n from public.fees where id = fee_card;
  assert n = 0, 'all_plans did not force plan_ids empty';

  -- 2. first sale: all three fees, charged, inside the subtotal -----------------
  m_a := (public.register_member('Fees A', '9850000001', br_a) ->> 'member_id')::uuid;
  perform public.renew_membership(m_a, plan_x, br_a);

  select i.subtotal_paisa, ms.signup_fee_paisa into sub, amount
  from public.memberships ms join public.invoices i on i.membership_id = ms.id
  where ms.member_id = m_a;
  assert sub = 180000, format('first sale subtotal %s, expected 100000 + 50000 + 20000 + 10000', sub);
  assert amount = 0, 'a catalogue sale wrote a legacy signup fee';

  select count(*) into n from public.membership_fees mf
  join public.memberships ms on ms.id = mf.membership_id where ms.member_id = m_a;
  assert n = 3, format('first sale recorded %s fee rows, expected 3', n);

  select string_agg(mf.name, ',' order by mf.sort_order) into txt
  from public.membership_fees mf join public.memberships ms on ms.id = mf.membership_id
  where ms.member_id = m_a;
  assert txt = 'Registration fee,Card fee,Locker', format('fee order was %s', txt);

  select sum(mf.charged_paisa), sum(mf.waived_paisa) into amount, sub
  from public.membership_fees mf join public.memberships ms on ms.id = mf.membership_id
  where ms.member_id = m_a;
  assert amount = 80000 and sub = 0, format('charged %s waived %s, expected 80000 / 0', amount, sub);

  -- 3. renewal: once-fees come off, every_sale repeats --------------------------
  perform public.renew_membership(m_a, plan_x, br_a);

  -- Both sales share a created_at inside one transaction, so tell them apart
  -- by price: the renewal is the cheaper invoice.
  select min(i.subtotal_paisa) into sub
  from public.memberships ms join public.invoices i on i.membership_id = ms.id
  where ms.member_id = m_a;
  assert sub = 110000, format('renewal subtotal %s, expected 100000 + 10000 locker', sub);

  select mf.charged_paisa, mf.waived_paisa into amount, sub
  from public.membership_fees mf join public.memberships ms on ms.id = mf.membership_id
  where ms.member_id = m_a and mf.name = 'Registration fee' and mf.waived_paisa > 0;
  assert amount = 0 and sub = 50000, format('renewal registration: charged %s waived %s', amount, sub);

  select count(*) into n
  from public.membership_fees mf join public.memberships ms on ms.id = mf.membership_id
  where ms.member_id = m_a and mf.name = 'Locker' and mf.charged_paisa = 10000 and mf.waived_paisa = 0;
  assert n = 2, format('the every_sale fee was charged %s times, expected 2', n);

  -- 4. partial assignment: plan Y carries only the all-plans fee ----------------
  m_b := (public.register_member('Fees B', '9850000002', br_a) ->> 'member_id')::uuid;
  perform public.renew_membership(m_b, plan_y, br_a);
  select string_agg(mf.name, ',') into txt
  from public.membership_fees mf join public.memberships ms on ms.id = mf.membership_id
  where ms.member_id = m_b;
  assert txt = 'Card fee', format('plan Y carried %s, expected only the all-plans fee', txt);

  -- 5. all_plans reaches a plan created after the fee ---------------------------
  perform pg_temp.act_as(org_a, st_own, 'owner');
  execute 'reset role';
  insert into public.membership_plans
    (id, org_id, name, plan_type, duration_days, price_paisa, signup_fee_paisa, branch_ids)
  values (plan_z, org_a, 'Plan Z', 'time', 30, 40000, 0, array[br_a]);
  perform pg_temp.act_as(org_a, st_own, 'owner');
  m_c := (public.register_member('Fees C', '9850000003', br_a) ->> 'member_id')::uuid;
  perform public.renew_membership(m_c, plan_z, br_a);
  select count(*) into n
  from public.membership_fees mf join public.memberships ms on ms.id = mf.membership_id
  where ms.member_id = m_c and mf.name = 'Card fee';
  assert n = 1, 'a plan created after an all-plans fee did not carry it';

  -- 6. a plan with no fees prints none: Plan W is unassigned and not covered ----
  -- (every fee is plan-limited or all-plans, so deactivate the all-plans fee to
  --  prove the empty case, then restore it.)
  update public.fees set is_active = false where id = fee_card;
  m_d := (public.register_member('Fees D', '9850000004', br_a) ->> 'member_id')::uuid;
  perform public.renew_membership(m_d, plan_y, br_a);
  select count(*) into n
  from public.membership_fees mf join public.memberships ms on ms.id = mf.membership_id
  where ms.member_id = m_d;
  assert n = 0, format('an inactive fee still produced %s rows', n);
  select i.subtotal_paisa into sub
  from public.memberships ms join public.invoices i on i.membership_id = ms.id
  where ms.member_id = m_d;
  assert sub = 50000, format('a plan with no fees billed %s, expected the plain 50000', sub);
  update public.fees set is_active = true where id = fee_card;

  -- 7. a recorded sale never moves ----------------------------------------------
  update public.fees set amount_paisa = 99900, name = 'Registration (new)' where id = fee_reg;
  select mf.charged_paisa, mf.name into amount, txt
  from public.membership_fees mf join public.memberships ms on ms.id = mf.membership_id
  where ms.member_id = m_a and mf.name like 'Registration%' and mf.charged_paisa > 0;
  assert amount = 50000 and txt = 'Registration fee',
    format('a fee edit rewrote history: %s / %s', amount, txt);

  -- Through the API there is no update or delete policy: zero rows, no error.
  update public.membership_fees set charged_paisa = 1 where org_id = org_a;
  get diagnostics n = row_count;
  assert n = 0, format('the API updated %s membership_fees rows', n);
  delete from public.membership_fees where org_id = org_a;
  get diagnostics n = row_count;
  assert n = 0, format('the API deleted %s membership_fees rows', n);

  -- Even the table owner is stopped by the trigger.
  execute 'reset role';
  begin
    update public.membership_fees set charged_paisa = 1 where org_id = org_a;
    assert false, 'the owner role edited membership_fees';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.membership_fees where org_id = org_a;
    assert false, 'the owner role deleted membership_fees';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.act_as(org_a, st_own, 'owner');

  -- 8. other roles read the catalogue and cannot change it ----------------------
  foreach txt in array array['manager', 'front_desk'] loop
    perform pg_temp.act_as(org_a, case txt when 'manager' then st_mgr else st_desk end, txt, array[br_a]);

    select count(*) into n from public.fees;
    assert n = 3, format('%s sees %s fees, expected 3', txt, n);

    begin
      insert into public.fees (org_id, name, charge_rule, amount_paisa, all_plans)
      values (org_a, 'Sneaky ' || txt, 'once', 100, true);
      assert false, format('%s created a fee', txt);
    exception when insufficient_privilege then null;
    end;

    update public.fees set amount_paisa = 1 where id = fee_card;
    get diagnostics n = row_count;
    assert n = 0, format('%s updated %s fees', txt, n);
  end loop;

  -- 9. discount is capped against the fee-inclusive subtotal --------------------
  perform pg_temp.act_as(org_a, st_own, 'owner');
  m_e := (public.register_member('Fees E', '9850000005', br_a) ->> 'member_id')::uuid;
  begin
    perform public.renew_membership(m_e, plan_x, br_a, p_discount_paisa => 999999999,
                                    p_discount_reason => 'other', p_discount_note => 'x');
    assert false, 'a discount above the subtotal was accepted';
  exception when check_violation then null;
  end;

  -- 10. cross-tenant ------------------------------------------------------------
  perform pg_temp.act_as(org_b, st_b, 'owner');
  select count(*) into n from public.fees;
  assert n = 0, format('org B sees %s of org A fees', n);
  select count(*) into n from public.membership_fees;
  assert n = 0, format('org B sees %s of org A membership_fees', n);
  begin
    insert into public.fees (org_id, name, charge_rule, amount_paisa, all_plans)
    values (org_a, 'Cross tenant', 'once', 100, true);
    assert false, 'org B created a fee in org A';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.fees (org_id, name, charge_rule, amount_paisa, plan_ids)
    values (org_b, 'Foreign plan', 'once', 100, array[plan_x]);
    assert false, 'a fee accepted a plan from another org';
  exception when foreign_key_violation then null;
  end;
  insert into public.fees (org_id, name, charge_rule, amount_paisa, all_plans)
  values (org_b, 'B fee', 'once', 100, true) returning id into fee_b;
  -- org A's plan X must not pick up org B's all-plans fee
  perform pg_temp.act_as(org_a, st_own, 'owner');
  select count(*) into n from public.sale_fees(plan_x, true) where name = 'B fee';
  assert n = 0, 'org B''s fee leaked into org A''s sale_fees';

  -- 11. the legacy path is untouched while the switch is off --------------------
  update public.orgs set fee_catalogue_enabled = false where id = org_a;
  execute 'reset role';
  update public.membership_plans set signup_fee_paisa = 30000 where id = plan_x;
  perform pg_temp.act_as(org_a, st_own, 'owner');
  m_f := (public.register_member('Fees F', '9850000006', br_a) ->> 'member_id')::uuid;
  perform public.renew_membership(m_f, plan_x, br_a);
  select i.subtotal_paisa, ms.signup_fee_paisa into sub, amount
  from public.memberships ms join public.invoices i on i.membership_id = ms.id
  where ms.member_id = m_f;
  assert sub = 130000 and amount = 30000,
    format('legacy sale: subtotal %s signup %s, expected 130000 / 30000', sub, amount);
  select count(*) into n
  from public.membership_fees mf join public.memberships ms on ms.id = mf.membership_id
  where ms.member_id = m_f;
  assert n = 0, 'the legacy path wrote membership_fees rows';
  update public.orgs set fee_catalogue_enabled = true where id = org_a;

  -- 12. deleting a plan removes it from fee plan lists --------------------------
  execute 'reset role';
  insert into public.membership_plans
    (id, org_id, name, plan_type, duration_days, price_paisa, branch_ids)
  values (plan_w, org_a, 'Plan W', 'time', 30, 10000, array[br_a]);
  update public.fees set plan_ids = array[plan_w] where id = fee_locker;
  delete from public.membership_plans where id = plan_w;
  select cardinality(plan_ids) into n from public.fees where id = fee_locker;
  assert n = 0, 'a deleted plan stayed in a fee plan list';

  -- 13. the catalogue and the sales are audited ---------------------------------
  select count(*) into n from public.audit_log
  where org_id = org_a and entity = 'fees' and action = 'INSERT';
  assert n >= 3, format('only %s fee inserts audited', n);
  select count(*) into n from public.audit_log
  where org_id = org_a and entity = 'fees' and action = 'UPDATE';
  assert n >= 1, 'fee updates were not audited';
  select count(*) into n from public.audit_log
  where org_id = org_a and entity = 'membership_fees' and action = 'INSERT';
  assert n >= 3, format('only %s membership_fees inserts audited', n);

  -- teardown ----------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'fees: all assertions passed';
end $$;
