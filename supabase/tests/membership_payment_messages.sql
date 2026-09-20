-- Gate for the three acknowledgements (2026-09-20): the welcome on the first
-- membership, the receipt on every payment, and the clearance when the last
-- invoice reaches zero.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/membership_payment_messages.sql

do $$
declare
  org_a uuid := 'a9a9a9a9-1111-1111-1111-111111111111';
  br_a1 uuid := 'a9b10000-0000-0000-0000-000000000001';

  st_owner uuid := 'a9c00000-0000-0000-0000-00000000000f';
  st_desk  uuid := 'a9c00000-0000-0000-0000-0000000000cd';

  plan_month uuid;

  res jsonb;
  member_off   uuid;
  member_part  uuid;
  member_quiet uuid;
  member_small uuid;
  invoice_part uuid;
  payment_one  uuid;

  n integer;
  msg public.notification_messages;
begin
  insert into public.orgs (id, name, slug) values
    (org_a, 'Hotel Fitness', 'hotel-fitness-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Hotel One');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_owner, org_a, 'Hotel Owner', 'owner@hotel.test', 'owner',      '{}',         'active'),
    (st_desk,  org_a, 'Hotel Desk',  'desk@hotel.test',  'front_desk', array[br_a1], 'active');

  insert into public.membership_plans
    (org_id, name, plan_type, duration_days, price_paisa, branch_ids)
  values (org_a, 'Monthly', 'time', 30, 250000, array[br_a1])
  returning id into plan_month;

  -- A gateway exists, so nothing below is skipped for want of one. `log_only`
  -- is the pipeline's own gateway: real rows, no HTTP.
  insert into public.notification_providers (org_id, channel, provider, sender_id)
  values (org_a, 'sms', 'log_only', 'Hotel');

  -- seeded rules: all three exist, all off ------------------------------------
  select count(*) into n from public.notification_rules
   where org_id = org_a
     and event in ('member_welcome'::public.notification_event,
                   'payment_received'::public.notification_event,
                   'dues_cleared'::public.notification_event);
  assert n = 3, format('expected three new rules, found %s', n);

  select count(*) into n from public.notification_rules
   where org_id = org_a
     and event in ('member_welcome'::public.notification_event,
                   'payment_received'::public.notification_event,
                   'dues_cleared'::public.notification_event)
     and enabled;
  assert n = 0, 'the three rules must arrive switched off';

  -- rules off: a whole sale goes through in silence ---------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  res := public.register_member(
    'Rule Off', '9861000001', br_a1,
    p_plan_id => plan_month, p_amount_paid_paisa => 250000
  );
  member_off := (res ->> 'member_id')::uuid;

  execute 'reset role';
  select count(*) into n from public.notification_messages where member_id = member_off;
  assert n = 0, format('disabled rules still queued %s messages', n);

  -- switched on ---------------------------------------------------------------
  update public.notification_rules set enabled = true
   where org_id = org_a
     and event in ('member_welcome'::public.notification_event,
                   'payment_received'::public.notification_event,
                   'dues_cleared'::public.notification_event);

  -- a part payment: welcome and receipt, but nothing is cleared ---------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  res := public.register_member(
    'Anita Gurung', '9861000002', br_a1,
    p_plan_id => plan_month, p_amount_paid_paisa => 100000
  );
  member_part  := (res ->> 'member_id')::uuid;
  invoice_part := (res ->> 'invoice_id')::uuid;
  payment_one  := (res ->> 'payment_id')::uuid;

  execute 'reset role';

  select * into msg from public.notification_messages
   where member_id = member_part
     and event = 'member_welcome'::public.notification_event;
  assert found, 'the welcome was not queued';
  assert msg.status = 'queued'::public.notification_status,
    format('welcome status was %s', msg.status);
  assert msg.branch_id = br_a1, 'the welcome lost the branch it happened at';
  assert msg.dedupe_key = 'member_welcome:' || member_part::text, 'wrong welcome dedupe key';
  assert msg.body like '%Anita Gurung%', format('the name was not rendered: %s', msg.body);
  assert msg.body like '%Hotel Fitness%', 'the gym name was not rendered';
  assert msg.body like '%Monthly%', 'the plan name was not rendered';
  assert msg.body not like '%{{%', format('a placeholder survived: %s', msg.body);

  select * into msg from public.notification_messages
   where member_id = member_part
     and event = 'payment_received'::public.notification_event;
  assert found, 'the receipt was not queued';
  assert msg.dedupe_key = 'payment_received:' || payment_one::text, 'wrong receipt dedupe key';
  -- 100000 paisa. The receipt must quote what was handed over, not the price.
  assert msg.body like '%Rs 1,000%', format('the amount was not rendered: %s', msg.body);
  assert msg.body not like '%{{%', format('a placeholder survived: %s', msg.body);

  select count(*) into n from public.notification_messages
   where member_id = member_part
     and event = 'dues_cleared'::public.notification_event;
  assert n = 0, 'a part payment was announced as a cleared balance';

  -- the rest of it: a second receipt, and the clearance ------------------------
  -- The gym's own wording, quoting the balance. This is what proves the
  -- receipt trigger runs AFTER `payments_sync_invoice`: read the invoice
  -- before the sync and the closing receipt would still say Rs 1,500 owing.
  insert into public.notification_templates (org_id, event, channel, locale, body)
  values (org_a, 'payment_received', 'sms', 'en',
          'Received {{amount}}, outstanding {{due_amount}}.');

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  perform public.record_payment(invoice_part, 150000);

  execute 'reset role';

  select count(*) into n from public.notification_messages
   where member_id = member_part
     and event = 'payment_received'::public.notification_event;
  assert n = 2, format('the second payment produced %s receipts in total, expected 2', n);

  select * into msg from public.notification_messages
   where member_id = member_part
     and event = 'dues_cleared'::public.notification_event;
  assert found, 'the cleared balance was not announced';
  assert msg.dedupe_key = 'dues_cleared:' || invoice_part::text, 'wrong clearance dedupe key';
  assert msg.body like '%Anita Gurung%', 'the clearance did not render the name';
  assert msg.body not like '%{{%', format('a placeholder survived: %s', msg.body);

  -- The receipt for the closing payment reads the balance AFTER the money
  -- arrived. `created_at` cannot pick it out -- both receipts were written in
  -- one transaction and share a timestamp to the microsecond -- so the body
  -- itself is the identity.
  select count(*) into n from public.notification_messages
   where member_id = member_part
     and event = 'payment_received'::public.notification_event
     and body = 'Received Rs 1,500, outstanding Rs 0.';
  assert n = 1, format('the closing receipt did not quote a settled balance: %s',
    (select string_agg(nm.body, ' | ') from public.notification_messages nm
      where nm.member_id = member_part
        and nm.event = 'payment_received'::public.notification_event));

  -- a renewal is not a joining -------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  perform public.renew_membership(
    member_part, plan_month, br_a1, p_amount_paid_paisa => 250000
  );

  execute 'reset role';

  select count(*) into n from public.notification_messages
   where member_id = member_part
     and event = 'member_welcome'::public.notification_event;
  assert n = 1, format('a renewal sent a second welcome (%s in total)', n);

  -- a refund says nothing ------------------------------------------------------
  insert into public.payments
    (org_id, branch_id, member_id, invoice_id, kind, amount_paisa, method,
     reason, collected_by)
  values
    (org_a, br_a1, member_part, invoice_part, 'refund', -50000, 'cash',
     'Rang up twice', st_owner);

  select count(*) into n from public.notification_messages
   where member_id = member_part
     and event = 'payment_received'::public.notification_event;
  assert n = 3, format('a refund was receipted (%s receipts in total)', n);

  -- Two clearances by now, and both are true: the first invoice, and the
  -- renewal's own, which was paid in full the moment it was raised.
  select count(*) into n from public.notification_messages
   where member_id = member_part
     and event = 'dues_cleared'::public.notification_event;
  assert n = 2, format('expected a clearance per settled invoice, found %s', n);

  -- Reopening the first invoice and closing it again does not re-announce it:
  -- the dedupe key is the invoice, and the receipt for that payment already
  -- said the money arrived.
  insert into public.payments
    (org_id, branch_id, member_id, invoice_id, kind, amount_paisa, method,
     collected_by)
  values (org_a, br_a1, member_part, invoice_part, 'payment', 50000, 'cash', st_owner);

  select count(*) into n from public.notification_messages
   where member_id = member_part
     and event = 'dues_cleared'::public.notification_event;
  assert n = 2, format('a reopened invoice announced its clearance again (%s)', n);

  -- an opted-out member is never written to ------------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  res := public.register_member('Quiet Please', '9861000003', br_a1);
  member_quiet := (res ->> 'member_id')::uuid;

  execute 'reset role';
  update public.members set notifications_opt_out = true where id = member_quiet;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  perform public.renew_membership(
    member_quiet, plan_month, br_a1, p_amount_paid_paisa => 250000
  );

  execute 'reset role';
  select count(*) into n from public.notification_messages where member_id = member_quiet;
  assert n = 0, format('an opted-out member got %s messages', n);

  -- the owner's floor on receipts ----------------------------------------------
  update public.notification_rules set min_amount_paisa = 200000
   where org_id = org_a and event = 'payment_received'::public.notification_event;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  res := public.register_member(
    'Small Change', '9861000004', br_a1,
    p_plan_id => plan_month, p_amount_paid_paisa => 50000
  );
  member_small := (res ->> 'member_id')::uuid;

  execute 'reset role';

  select count(*) into n from public.notification_messages
   where member_id = member_small
     and event = 'payment_received'::public.notification_event;
  assert n = 0, 'a payment under the floor was still receipted';

  -- The welcome has no floor of its own and must still have gone.
  select count(*) into n from public.notification_messages
   where member_id = member_small
     and event = 'member_welcome'::public.notification_event;
  assert n = 1, format('the welcome was suppressed by the receipt floor (%s)', n);

  -- one debt clears while another is open: nothing is announced -----------------
  -- A second sale, paid in full. Its own invoice reaches zero, but the first
  -- one is still short Rs 2,000, so "nothing is outstanding" stays unsent.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  perform public.renew_membership(
    member_small, plan_month, br_a1, p_amount_paid_paisa => 250000
  );

  execute 'reset role';

  select count(*) into n from public.notification_messages
   where member_id = member_small
     and event = 'dues_cleared'::public.notification_event;
  assert n = 0, 'a member who still owes money on another invoice was told they owe nothing';

  -- the contactable check is internal --------------------------------------------
  -- It reads any member row by id with definer rights and no tenant check, so
  -- on the REST surface it would be a boolean oracle over every gym.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  declare
    reachable boolean := true;
  begin
    begin
      perform public.member_is_contactable(member_part);
    exception when insufficient_privilege then reachable := false;
    end;
    assert not reachable, 'member_is_contactable is callable by a client role';
  end;

  -- teardown --------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id = org_a;

  raise notice 'membership_payment_messages: all assertions passed';
end $$;
