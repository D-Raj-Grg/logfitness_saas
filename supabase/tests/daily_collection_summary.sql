-- Gate for the drawer sheet's numbers: that they add up, that they agree with
-- the two reports either side of them, and that the lines behind a group really
-- are the group.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/daily_collection_summary.sql

do $$
declare
  org_s  uuid := 'c5c5c5c5-3333-3333-3333-333333333333';
  br_one uuid := 'c5b10000-0000-0000-0000-000000000001';
  br_two uuid := 'c5b10000-0000-0000-0000-000000000002';
  st_own uuid := 'c5c00000-0000-0000-0000-00000000000a';
  plan_s uuid := 'c5d00000-0000-0000-0000-000000000001';

  member_a uuid; invoice_a uuid; payment_a uuid;
  member_b uuid; invoice_b uuid;
  member_c uuid; invoice_c uuid; payment_c uuid;
  member_d uuid; invoice_d uuid;

  today date;
  yesterday date;

  totals record;
  one record;
  two record;
  prev record;

  n bigint;
  amount bigint;
  note text;
  expected bigint;
begin
  insert into public.orgs (id, name, slug, standard_signup_fee_paisa)
  values (org_s, 'Sheet Gym', 'sheet-gym-test', 0);

  insert into public.branches (id, org_id, name) values
    (br_one, org_s, 'Sheet One'),
    (br_two, org_s, 'Sheet Two');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status)
  values (st_own, org_s, 'Sheet Owner', 'owner@sheet.test', 'owner', '{}', 'active');

  insert into public.membership_plans
    (id, org_id, name, plan_type, duration_days, price_paisa, signup_fee_paisa, branch_ids)
  values (plan_s, org_s, 'Monthly', 'time', 30, 660000, 0, array[br_one, br_two]);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_s::text, 'staff_id', st_own::text, 'staff_role', 'owner',
    'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  today := public.org_today(org_s);
  yesterday := today - 1;

  -- Paid in full, in cash, at branch one.
  member_a := (public.register_member('Cash Payer', '9860000001', br_one,
    p_plan_id => plan_s, p_amount_paid_paisa => 660000,
    p_method => 'cash') ->> 'member_id')::uuid;
  select i.id into invoice_a from public.invoices i where i.member_id = member_a;
  select p.id into payment_a from public.payments p where p.invoice_id = invoice_a;

  -- Part paid, digitally, with a festival discount. This is the row that makes
  -- billed_paisa and net_paisa differ.
  member_b := (public.register_member('Part Payer', '9860000002', br_one,
    p_plan_id => plan_s, p_discount_paisa => 60000,
    p_discount_reason => 'festival',
    p_amount_paid_paisa => 300000, p_method => 'esewa',
    p_reference_no => 'ESW-1') ->> 'member_id')::uuid;
  select i.id into invoice_b from public.invoices i where i.member_id = member_b;

  -- Branch two, in cash, and then partly refunded.
  member_c := (public.register_member('Refunded', '9860000003', br_two,
    p_plan_id => plan_s, p_amount_paid_paisa => 200000,
    p_method => 'cash') ->> 'member_id')::uuid;
  select i.id into invoice_c from public.invoices i where i.member_id = member_c;
  select p.id into payment_c from public.payments p where p.invoice_id = invoice_c;
  perform public.refund_payment(payment_c, 50000, 'Changed their mind');

  -- The same member paying at a second branch, which is what makes
  -- distinct_payers non-additive across the totals row.
  insert into public.payments
    (org_id, branch_id, member_id, kind, amount_paisa, method, collected_by)
  values (org_s, br_two, member_a, 'payment', 40000, 'cash', st_own);

  -- An invoice raised YESTERDAY, paid today. It must move net_paisa without
  -- touching billed_paisa -- the whole reason the two are separate columns.
  member_d := (public.register_member('Yesterday Bill', '9860000004', br_one,
    p_plan_id => plan_s) ->> 'member_id')::uuid;
  select i.id into invoice_d from public.invoices i where i.member_id = member_d;

  perform set_config('app.adjust_invoice_money', 'on', true);
  update public.invoices set issued_on = yesterday where id = invoice_d;
  perform set_config('app.adjust_invoice_money', 'off', true);

  perform public.record_payment(invoice_d, 100000, 'cash');

  select * into totals from public.daily_collection_summary(today, null)
   where branch_id is null;
  select * into one from public.daily_collection_summary(today, array[br_one])
   where branch_id = br_one;
  select * into two from public.daily_collection_summary(today, array[br_two])
   where branch_id = br_two;

  -- 1. The arithmetic the whole sheet rests on.
  assert totals.gross_paisa - totals.refunds_paisa - totals.reversals_paisa = totals.net_paisa,
    format('gross %s - refunds %s - reversals %s <> net %s',
      totals.gross_paisa, totals.refunds_paisa, totals.reversals_paisa, totals.net_paisa);
  assert one.gross_paisa - one.refunds_paisa - one.reversals_paisa = one.net_paisa,
    'branch one does not balance';
  assert two.gross_paisa - two.refunds_paisa - two.reversals_paisa = two.net_paisa,
    'branch two does not balance';

  -- 2. The sheet's own two halves agree: the summary and the grouped table.
  select coalesce(sum(dc.amount_paisa), 0) into amount
  from public.daily_collection(today, null) dc;
  assert amount = totals.net_paisa,
    format('daily_collection nets %s, summary says %s', amount, totals.net_paisa);

  -- 3. And the revenue report, which answers the same question over a range.
  select coalesce(sum(rr.net_paisa), 0) into amount
  from public.revenue_report(null, today, today, 'day') rr;
  assert amount = totals.net_paisa,
    format('revenue_report nets %s, summary says %s', amount, totals.net_paisa);

  select coalesce(sum(rr.refunds_paisa), 0) into amount
  from public.revenue_report(null, today, today, 'day') rr;
  assert amount = totals.refunds_paisa,
    format('revenue_report refunds %s, summary says %s', amount, totals.refunds_paisa);

  -- 4. What should be in the cash box, and what is in a wallet instead.
  assert totals.cash_paisa + totals.digital_paisa = totals.net_paisa,
    format('cash %s + digital %s <> net %s',
      totals.cash_paisa, totals.digital_paisa, totals.net_paisa);
  -- The refund was cash, so it came out of the drawer, not out of eSewa.
  assert two.cash_paisa = 200000 - 50000 + 40000,
    format('branch two cash was %s', two.cash_paisa);
  assert one.digital_paisa = 300000, format('branch one digital was %s', one.digital_paisa);

  -- 5. A refund is not a sale. The headline count must not say it was.
  assert totals.txn_count = totals.payment_count + totals.refund_count + totals.reversal_count,
    'the kind counts do not add up to txn_count';
  assert totals.refund_count = 1, format('refund_count was %s', totals.refund_count);
  assert totals.payment_count = 5, format('payment_count was %s', totals.payment_count);

  select coalesce(sum(dc.txn_count), 0) into n from public.daily_collection(today, null) dc;
  assert n = totals.txn_count,
    format('daily_collection counts %s rows, summary says %s', n, totals.txn_count);

  -- 6. People, not rows. Four members paid; member_a paid at both branches, so
  --    the totals row must re-count rather than sum. This column is deliberately
  --    not additive and the assertion below is what says so out loud.
  assert totals.distinct_payers = 4,
    format('distinct_payers was %s, expected 4', totals.distinct_payers);
  assert one.distinct_payers + two.distinct_payers = 5,
    format('the branch rows should double-count member_a; got %s',
      one.distinct_payers + two.distinct_payers);
  assert totals.distinct_payers < one.distinct_payers + two.distinct_payers,
    'the cross-branch payer case never fired, so non-additivity is untested';

  -- 7. Billed is not collected.
  assert one.billed_paisa = 660000 + 600000,
    format('branch one billed %s', one.billed_paisa);
  assert one.billed_due_paisa = 300000,
    format('branch one still owed %s, expected the 300000 shortfall', one.billed_due_paisa);
  -- Yesterday's invoice was paid today: the money moved, the billing did not.
  assert one.net_paisa > 0 and one.invoice_count = 2,
    format('yesterday''s invoice leaked into today''s billing; invoice_count %s',
      one.invoice_count);

  -- 8. Discounts reconcile with the report that breaks them down.
  select coalesce(sum(dr.discount_paisa), 0) into amount
  from public.discount_report(null, today, today) dr;
  assert amount = totals.billed_discount_paisa,
    format('discount_report totals %s, summary says %s', amount, totals.billed_discount_paisa);
  assert amount = 60000, format('the festival discount came back as %s', amount);

  select dr.discount_paisa into amount
  from public.discount_report(null, today, today) dr where dr.reason = 'festival';
  assert amount = 60000, 'the discount did not land under festival';

  -- Re-pricing after the sale moves the reported figure, which is what proves
  -- this reads invoices rather than the membership row.
  perform public.adjust_membership_discount(
    (select ms.id from public.memberships ms where ms.member_id = member_b),
    90000, 'corporate', 'Renegotiated');

  select coalesce(sum(dr.discount_paisa), 0) into amount
  from public.discount_report(null, today, today) dr;
  assert amount = 90000,
    format('a re-priced sale still reports %s of discount', amount);

  -- 9. The lines behind a group really are the group.
  select count(*), coalesce(sum(d.amount_paisa), 0) into n, amount
  from public.daily_collection_detail(today, null) d;
  assert n = totals.txn_count,
    format('detail returned %s rows against %s transactions', n, totals.txn_count);
  assert amount = totals.net_paisa,
    format('detail sums to %s against a net of %s', amount, totals.net_paisa);

  -- Every line names its member, or the drill-down cannot answer "who paid".
  select count(*) into n
  from public.daily_collection_detail(today, null) d
  where d.member_name is null or d.staff_name is null;
  assert n = 0, format('%s detail lines came back unnamed', n);

  -- 9b. And it carries the two things the member list is asked for next: how
  --     to reach them, and whether they are square. The balance is the whole
  --     outstanding one, not this invoice's remainder, so the part payer still
  --     shows the shortfall.
  select d.member_phone, d.member_due_paisa into note, amount
  from public.daily_collection_detail(today, null) d
  where d.member_id = member_b limit 1;
  assert note = '9860000002', format('the phone came back as %s', note);
  assert amount = 300000,
    format('the part payer still owes %s, expected the 300000 shortfall', amount);

  select d.member_due_paisa into amount
  from public.daily_collection_detail(today, null) d
  where d.member_id = member_a limit 1;
  assert amount = 0, format('a settled member still shows %s owing', amount);

  -- 10. The day boundary is the org's, not UTC's.
  select * into prev from public.daily_collection_summary(yesterday, null)
   where branch_id is null;
  assert prev.net_paisa = 0,
    format('yesterday collected %s, but nothing was taken then', prev.net_paisa);
  -- Yesterday's invoice is still yesterday's billing.
  assert prev.billed_paisa = 660000,
    format('yesterday billed %s', prev.billed_paisa);

  -- 11. A branch list is a filter, never a grant: branch two's figures must not
  --     appear when only branch one is asked for.
  select coalesce(sum(s.net_paisa), 0) into amount
  from public.daily_collection_summary(today, array[br_one]) s
  where s.branch_id is not null;
  assert amount = one.net_paisa, 'scoping to one branch returned more than it';

  -- 12. And the no-argument form still answers.
  perform public.daily_collection_summary(null, null);
  perform public.daily_collection_detail(null, null);
  perform public.discount_report(null, null, null);

  -- teardown ------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id = org_s;

  raise notice 'daily collection summary: all assertions passed';
end $$;
