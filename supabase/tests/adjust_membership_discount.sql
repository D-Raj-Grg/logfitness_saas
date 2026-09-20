-- Gate for lowering a price after the sale: that only the people who answer
-- for the takings can do it, that it can only ever come down, that money
-- already collected cannot be un-billed, and that the invoice's money columns
-- are now shut to everything except this one function.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/adjust_membership_discount.sql

do $$
declare
  org_p  uuid := 'a9a9a9a9-1111-1111-1111-111111111111';
  br_one uuid := 'a9b10000-0000-0000-0000-000000000001';
  br_two uuid := 'a9b10000-0000-0000-0000-000000000002';
  st_own uuid := 'a9c00000-0000-0000-0000-00000000000a';
  st_mgr uuid := 'a9c00000-0000-0000-0000-00000000000b';
  st_desk uuid := 'a9c00000-0000-0000-0000-00000000000c';
  st_mgr_one uuid := 'a9c00000-0000-0000-0000-00000000000d';
  plan_p uuid := 'a9d00000-0000-0000-0000-000000000001';

  member_a uuid;
  membership_a uuid;
  invoice_a uuid;

  member_b uuid;
  membership_b uuid;
  invoice_b uuid;

  member_c uuid;
  membership_c uuid;

  member_d uuid;
  membership_d uuid;

  member_e uuid;
  membership_e uuid;

  result jsonb;
  amount bigint;
  state public.invoice_status;
  reason public.discount_reason;
  note text;
  memo text;
  failed boolean;
begin
  insert into public.orgs (id, name, slug, standard_signup_fee_paisa)
  values (org_p, 'Price Gym', 'price-gym-test', 0);

  insert into public.branches (id, org_id, name) values
    (br_one, org_p, 'Price One'),
    (br_two, org_p, 'Price Two');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_own, org_p, 'Price Owner', 'owner@price.test', 'owner', '{}', 'active'),
    (st_mgr, org_p, 'Price Manager', 'manager@price.test', 'manager', array[br_two], 'active'),
    (st_desk, org_p, 'Price Desk', 'desk@price.test', 'front_desk', array[br_one], 'active'),
    (st_mgr_one, org_p, 'Price Manager One', 'manager1@price.test', 'manager', array[br_one], 'active');

  -- 6,600 is the number from the gym that asked for this.
  insert into public.membership_plans
    (id, org_id, name, plan_type, duration_days, price_paisa, signup_fee_paisa, branch_ids)
  values (plan_p, org_p, 'Gym + Cardio - 3 Months', 'time', 90, 660000, 0, array[br_one, br_two]);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_p::text, 'staff_id', st_own::text, 'staff_role', 'owner',
    'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  member_a := (public.register_member('Unpaid Member', '9840000001', br_one,
    p_plan_id => plan_p) ->> 'member_id')::uuid;
  select ms.id into membership_a from public.memberships ms where ms.member_id = member_a;
  select i.id into invoice_a from public.invoices i where i.membership_id = membership_a;

  -- 1. The desk sells; it does not give money away on a sale already rung up.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_p::text, 'staff_id', st_desk::text, 'staff_role', 'front_desk',
    'branch_ids', json_build_array(br_one::text)
  )::text, true);

  failed := false;
  begin
    perform public.adjust_membership_discount(membership_a, 60000, 'other',
      'Negotiated with the member', 'Client asked again');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'the front desk lowered a price';

  -- 2. A manager answers for their own branch, not for someone else's.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_p::text, 'staff_id', st_mgr::text, 'staff_role', 'manager',
    'branch_ids', json_build_array(br_two::text)
  )::text, true);

  failed := false;
  begin
    perform public.adjust_membership_discount(membership_a, 60000, 'other',
      'Negotiated with the member', 'Client asked again');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a manager lowered a price at another branch';

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_p::text, 'staff_id', st_own::text, 'staff_role', 'owner',
    'branch_ids', json_build_array()
  )::text, true);

  -- 3. 6,600 -> 6,000. The plan's price is a fact and stays one; the discount
  --    is what moves, on the sale and on the paper the member is handed.
  result := public.adjust_membership_discount(membership_a, 60000, 'other',
    'Negotiated with the member', 'Client asked for a second discount');

  assert (result ->> 'total_paisa')::bigint = 600000,
    format('total was %s, expected 600000', result ->> 'total_paisa');
  assert (result ->> 'previous_discount_paisa')::bigint = 0, 'previous discount was not reported';
  assert (result ->> 'due_paisa')::bigint = 600000,
    format('due was %s, expected 600000', result ->> 'due_paisa');

  select ms.price_paisa into amount from public.memberships ms where ms.id = membership_a;
  assert amount = 660000, format('the plan price moved to %s', amount);

  select ms.discount_paisa, ms.discount_reason, ms.discount_note, ms.notes
    into amount, reason, note, memo
  from public.memberships ms where ms.id = membership_a;
  assert amount = 60000, format('membership discount was %s', amount);
  assert reason = 'other', format('membership reason was %s', reason);
  assert note = 'Client asked for a second discount', format('note was %s', note);
  assert memo like '%price 6600.00 -> 6000.00 (Negotiated with the member)%',
    format('the reason was not written on the membership: %s', memo);

  select i.subtotal_paisa into amount from public.invoices i where i.id = invoice_a;
  assert amount = 660000, format('the invoice subtotal moved to %s', amount);
  select i.total_paisa into amount from public.invoices i where i.id = invoice_a;
  assert amount = 600000, format('the invoice total was %s', amount);
  select i.due_paisa into amount from public.invoices i where i.id = invoice_a;
  assert amount = 600000, format('the due was %s', amount);
  select i.discount_reason into reason from public.invoices i where i.id = invoice_a;
  assert reason = 'other', 'the reason did not reach the invoice';

  -- 4. A price never walks back up: that would be a new charge on a bill the
  --    member has already been handed. An unchanged one is refused too --
  --    there is nothing to record.
  failed := false;
  begin
    perform public.adjust_membership_discount(membership_a, 30000, 'festival', 'Changed my mind');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a price was put back up';

  failed := false;
  begin
    perform public.adjust_membership_discount(membership_a, 60000, 'festival', 'Same again');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a price was "changed" to what it already was';

  -- 5. Lowering it further is fine, and the audit sentences stack.
  perform public.adjust_membership_discount(membership_a, 66000, 'festival', 'Dashain offer applied late');

  select ms.notes into memo from public.memberships ms where ms.id = membership_a;
  assert memo like '%(Negotiated with the member)%' and memo like '%(Dashain offer applied late)%',
    format('an earlier adjustment was overwritten: %s', memo);
  select ms.discount_note into note from public.memberships ms where ms.id = membership_a;
  assert note is null, 'a named reason kept the note from the previous adjustment';

  -- 6. Part-paid: the total lands exactly on what was collected, so the bill
  --    settles itself without a payment row.
  member_b := (public.register_member('Part Paid', '9840000002', br_one,
    p_plan_id => plan_p, p_amount_paid_paisa => 600000) ->> 'member_id')::uuid;
  select ms.id into membership_b from public.memberships ms where ms.member_id = member_b;
  select i.id into invoice_b from public.invoices i where i.membership_id = membership_b;

  select i.status into state from public.invoices i where i.id = invoice_b;
  assert state = 'partial', format('the invoice started as %s', state);

  result := public.adjust_membership_discount(membership_b, 60000, 'corporate', 'Corporate rate agreed late');
  assert (result ->> 'status') = 'paid', format('status was %s, expected paid', result ->> 'status');
  assert (result ->> 'due_paisa')::bigint = 0, format('due was %s, expected 0', result ->> 'due_paisa');

  -- 7. Below what is already in the drawer, money leaves by the refund door.
  failed := false;
  begin
    perform public.adjust_membership_discount(membership_b, 120000, 'corporate', 'Too far');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a price was dropped below what had been collected';

  -- 8. A discount cannot exceed the price, a change cannot be unexplained, and
  --    'other' is an escape hatch rather than a way around the rule.
  failed := false;
  begin
    perform public.adjust_membership_discount(membership_a, 700000, 'festival', 'More than the plan');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a discount exceeded the price';

  failed := false;
  begin
    perform public.adjust_membership_discount(membership_a, 70000, 'festival', '   ');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a price change was recorded with no reason';

  failed := false;
  begin
    perform public.adjust_membership_discount(membership_a, 70000, 'other', 'Why not');
  exception when check_violation then failed := true;
  end;
  assert failed, 'other was accepted without a note';

  -- 9. A cancelled membership is finished; sell a new one.
  member_c := (public.register_member('Cancelled Member', '9840000003', br_one,
    p_plan_id => plan_p) ->> 'member_id')::uuid;
  select ms.id into membership_c from public.memberships ms where ms.member_id = member_c;
  perform public.cancel_membership(membership_c, 'Moved away');

  failed := false;
  begin
    perform public.adjust_membership_discount(membership_c, 60000, 'festival', 'Too late');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a cancelled membership was re-priced';

  -- 10. A membership sold with no invoice has no bill to correct. (Registering
  --     without a plan leaves no membership at all, so this is the sale that
  --     was rung up and then had its invoice removed by a cascade -- the
  --     nearest reachable shape is a membership row inserted directly.)
  member_d := (public.register_member('No Invoice', '9840000004', br_one) ->> 'member_id')::uuid;
  insert into public.memberships
    (org_id, branch_id, member_id, plan_id, plan_name, plan_type,
     start_date, end_date, price_paisa, discount_paisa, status, sold_by)
  values (org_p, br_one, member_d, plan_p, 'Gym + Cardio - 3 Months', 'time',
     public.org_today(org_p), public.org_today(org_p) + 90, 660000, 0, 'active', st_own)
  returning id into membership_d;

  failed := false;
  begin
    perform public.adjust_membership_discount(membership_d, 60000, 'festival', 'Nothing to correct');
  exception when no_data_found then failed := true;
  end;
  assert failed, 'a membership with no invoice was re-priced';

  -- 10b. The manager who actually runs the branch can re-price, and this is
  --      the only assertion that exercises the invoice UPDATE policy as
  --      somebody other than an owner. Without it, assertion 2 above would
  --      pass even if the gate were broken, because a manager with no branch
  --      claim is refused everywhere.
  member_e := (public.register_member('Manager Case', '9840000005', br_one,
    p_plan_id => plan_p) ->> 'member_id')::uuid;
  select ms.id into membership_e from public.memberships ms where ms.member_id = member_e;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_p::text, 'staff_id', st_mgr_one::text, 'staff_role', 'manager',
    'branch_ids', json_build_array(br_one::text)
  )::text, true);

  result := public.adjust_membership_discount(membership_e, 60000, 'corporate',
    'Manager approved');
  assert (result ->> 'total_paisa')::bigint = 600000,
    format('a branch manager could not re-price their own branch: total %s', result ->> 'total_paisa');

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_p::text, 'staff_id', st_own::text, 'staff_role', 'owner',
    'branch_ids', json_build_array()
  )::text, true);

  -- 11. The door is the function, not the table. A direct UPDATE cannot set a
  --     GUC, so PostgREST is shut out of both sides of the sale.
  failed := false;
  begin
    update public.memberships set discount_paisa = 100000 where id = membership_a;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a membership discount was rewritten directly';

  failed := false;
  begin
    update public.invoices set total_paisa = 0, discount_paisa = 660000 where id = invoice_a;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'an invoice total was rewritten directly';

  failed := false;
  begin
    update public.invoices set subtotal_paisa = 0 where id = invoice_a;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'an invoice subtotal was rewritten directly';

  -- A due cleared by hand is a due cleared without money, so what an invoice
  -- has been paid is as frozen as what it charges.
  failed := false;
  begin
    update public.invoices set status = 'void' where id = invoice_a;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'an invoice was voided by hand';

  failed := false;
  begin
    update public.invoices set paid_paisa = 600000 where id = invoice_a;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'an invoice was marked paid by hand';

  -- 12. And the guard is column-scoped, not a blanket freeze: the notes on an
  --     invoice are still the gym's to edit.
  update public.invoices set notes = 'Collected at the counter' where id = invoice_a;
  select i.notes into memo from public.invoices i where i.id = invoice_a;
  assert memo = 'Collected at the counter', 'the guard froze the invoice notes as well';

  -- 13. Payments still settle their invoice through the same guarded columns.
  select i.due_paisa into amount from public.invoices i where i.id = invoice_a;
  perform public.record_payment(invoice_a, amount, 'cash');
  select i.status, i.due_paisa into state, amount from public.invoices i where i.id = invoice_a;
  assert state = 'paid' and amount = 0, format('the invoice settled as %s with %s due', state, amount);

  -- teardown ------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id = org_p;

  raise notice 'adjust membership discount: all assertions passed';
end $$;
