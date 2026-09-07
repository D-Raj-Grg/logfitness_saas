-- Gate for reverse_payment(): the correction for money that was recorded but
-- never received.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/reverse_payment.sql

do $$
declare
  org_a uuid := 'e1e1e1e1-1111-1111-1111-111111111111';
  br_a1 uuid := 'e1b10000-0000-0000-0000-000000000001';
  br_a2 uuid := 'e1b10000-0000-0000-0000-000000000002';
  st_owner uuid := 'e1c00000-0000-0000-0000-00000000000f';
  st_mgr2  uuid := 'e1c00000-0000-0000-0000-00000000000b';
  st_desk  uuid := 'e1c00000-0000-0000-0000-00000000000d';

  plan_month uuid;
  res jsonb;
  member_1 uuid;
  invoice_1 uuid;
  payment_1 uuid;
  reversal_1 uuid;
  member_2 uuid;
  invoice_2 uuid;
  payment_2 uuid;
  reversal_2 uuid;
  reverser uuid;
  n integer;
  txt text;
  amount bigint;
  failed boolean;
begin
  insert into public.orgs (id, name, slug) values (org_a, 'Eta Fitness', 'eta-fitness-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Eta One'),
    (br_a2, org_a, 'Eta Two');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_owner, org_a, 'Eta Owner',   'owner@eta.test', 'owner',      '{}',         'active'),
    (st_mgr2,  org_a, 'Eta Manager', 'mgr@eta.test',   'manager',    array[br_a2], 'active'),
    (st_desk,  org_a, 'Eta Desk',    'desk@eta.test',  'front_desk', array[br_a1], 'active');

  -- persona: owner, seeding the catalogue --------------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  insert into public.membership_plans
    (org_id, name, plan_type, duration_days, price_paisa, branch_ids)
  values (org_a, 'Monthly', 'time', 30, 250000, array[br_a1])
  returning id into plan_month;

  -- persona: front desk ---------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  -- Rung up as paid in cash, which is the mistake this exists to correct.
  res := public.register_member(
    'Roshan Shah', '9870000001', br_a1,
    p_plan_id => plan_month, p_amount_paid_paisa => 250000
  );
  member_1 := (res ->> 'member_id')::uuid;
  invoice_1 := (res ->> 'invoice_id')::uuid;
  payment_1 := (res ->> 'payment_id')::uuid;

  select i.due_paisa, i.status::text into amount, txt
  from public.invoices i where i.id = invoice_1;
  assert amount = 0, format('the invoice still owed %s after a full payment', amount);
  assert txt = 'paid', format('the invoice was %L, not paid', txt);

  -- The desk records money; it does not decide that money never came.
  failed := false;
  begin
    perform public.reverse_payment(payment_1, 'They never paid');
  exception when others then failed := true;
  end;
  assert failed, 'the front desk reversed its own payment';

  -- persona: manager of the other branch ----------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_mgr2::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(br_a2::text)
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.reverse_payment(payment_1, 'Not my branch');
  exception when others then failed := true;
  end;
  assert failed, 'a manager reversed a payment taken at another branch';

  -- persona: owner ---------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.reverse_payment(payment_1, '  ');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a reversal was accepted with no reason';

  res := public.reverse_payment(payment_1, '  Said they would pay tomorrow  ');
  reversal_1 := (res ->> 'reversal_id')::uuid;

  assert (res ->> 'due_paisa')::bigint = 250000,
    format('the invoice owed %s after the reversal', res ->> 'due_paisa');
  assert res ->> 'status' = 'unpaid',
    format('the invoice came back as %L', res ->> 'status');

  -- The original stays on the books. That is what keeps the drawer countable.
  select count(*) into n from public.payments p where p.id = payment_1;
  assert n = 1, 'the original payment was destroyed';

  select p.kind::text into txt from public.payments p where p.id = reversal_1;
  assert txt = 'reversal', format('the correction was booked as %L', txt);

  select p.amount_paisa into amount from public.payments p where p.id = reversal_1;
  assert amount = -250000, format('the reversal was %s', amount);

  select p.reason into txt from public.payments p where p.id = reversal_1;
  assert txt = 'Said they would pay tomorrow', format('the reason was %L', txt);

  -- Carried over from the original, so the correction lands on the same column
  -- of the drawer sheet the money was said to have arrived in.
  select p.method::text into txt from public.payments p where p.id = reversal_1;
  assert txt = 'cash', format('the reversal was booked as %L', txt);

  select p.collected_by into reverser from public.payments p where p.id = reversal_1;
  assert reverser = st_owner, 'the reverser was not recorded';

  -- The day nets to nothing, and the two lines are told apart by kind.
  select coalesce(sum(d.amount_paisa), 0) into amount
  from public.daily_collection(null, array[br_a1]) d;
  assert amount = 0, format('the drawer netted %s after a reversal', amount);

  select count(*) into n
  from public.daily_collection(null, array[br_a1]) d where d.kind = 'reversal';
  assert n = 1, format('the sheet showed %s reversal lines', n);

  -- The member owes it again, so they turn up in arrears.
  select count(*) into n
  from public.arrears_report(array[br_a1]) a where a.due_paisa = 250000;
  assert n = 1, 'the reversed sale did not come back as arrears';

  -- A reversal is not itself reversible, and the invoice cannot be emptied twice.
  failed := false;
  begin
    perform public.reverse_payment(reversal_1, 'Undo the undo');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a reversal was reversed';

  failed := false;
  begin
    perform public.reverse_payment(payment_1, 'Again');
  exception when check_violation then failed := true;
  end;
  assert failed, 'the same payment was reversed twice';

  -- A part of an entry that never arrived -------------------------------------
  -- Rung up as 2,500 in cash when only 1,000 was handed over. The correction is
  -- one negative row for the 1,500, not a full undo and a fresh payment.
  res := public.register_member(
    'Anil Parajuli', '9870000002', br_a1,
    p_plan_id => plan_month, p_amount_paid_paisa => 250000
  );
  member_2 := (res ->> 'member_id')::uuid;
  invoice_2 := (res ->> 'invoice_id')::uuid;
  payment_2 := (res ->> 'payment_id')::uuid;

  failed := false;
  begin
    perform public.reverse_payment(payment_2, 'Too much', 250001);
  exception when check_violation then failed := true;
  end;
  assert failed, 'more was taken back than the entry ever held';

  failed := false;
  begin
    perform public.reverse_payment(payment_2, 'Nothing', 0);
  exception when check_violation then failed := true;
  end;
  assert failed, 'a reversal of nothing was accepted';

  res := public.reverse_payment(payment_2, 'Only 1,000 was handed over', 150000);
  reversal_2 := (res ->> 'reversal_id')::uuid;

  assert (res ->> 'due_paisa')::bigint = 150000,
    format('the invoice owed %s after a part reversal', res ->> 'due_paisa');
  assert res ->> 'status' = 'partial',
    format('the part-paid invoice read as %L', res ->> 'status');

  select p.amount_paisa, p.kind::text into amount, txt
  from public.payments p where p.id = reversal_2;
  assert amount = -150000, format('the part reversal was %s', amount);
  assert txt = 'reversal', format('the part correction was booked as %L', txt);

  select i.paid_paisa into amount from public.invoices i where i.id = invoice_2;
  assert amount = 100000, format('the invoice was left holding %s', amount);

  -- What is left standing is the ceiling on any further correction.
  failed := false;
  begin
    perform public.reverse_payment(payment_2, 'The rest and then some', 150000);
  exception when check_violation then failed := true;
  end;
  assert failed, 'a second part reversal went past what the invoice still held';

  -- The member owes the balance, so they show up in arrears for it.
  select count(*) into n
  from public.arrears_report(array[br_a1]) a
  where a.member_id = member_2 and a.due_paisa = 150000;
  assert n = 1, 'the part-paid sale did not come back as arrears for the balance';

  -- Nor can the whole entry go back once part of it already has: what is left
  -- standing on the invoice is the ceiling, whatever the original said.
  failed := false;
  begin
    perform public.reverse_payment(payment_2, 'The rest never came either');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a full reversal ran past what the invoice still held';

  res := public.reverse_payment(payment_2, 'The rest never came either', 100000);
  assert (res ->> 'due_paisa')::bigint = 250000,
    format('the invoice owed %s once the balance went back too', res ->> 'due_paisa');
  assert res ->> 'status' = 'unpaid',
    format('the emptied invoice read as %L', res ->> 'status');

  -- teardown ----------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id = org_a;

  raise notice 'reverse payment: all assertions passed';
end $$;
