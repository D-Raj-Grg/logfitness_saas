-- Printed card numbers (card stock): numbering a run of blank cards, linking a
-- printed number to the chip inside it, handing a numbered card to a member by
-- typing its number, taking it back, marking it lost, and who may read what.
--
-- Seeds two orgs, drives the real RPCs as real personas, asserts, then removes
-- its fixtures. A failed assertion aborts.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/card_stock.sql

do $$
declare
  org_a uuid := 'c5c5c5c5-1111-1111-1111-111111111111';
  org_b uuid := 'c6c6c6c6-2222-2222-2222-222222222222';
  br_a1 uuid := 'c5b00000-0000-0000-0000-000000000001';
  br_b1 uuid := 'c6b00000-0000-0000-0000-000000000001';
  st_owner uuid := 'c5000000-0000-0000-0000-00000000000f';
  st_mgr   uuid := 'c5000000-0000-0000-0000-00000000000a';
  st_desk  uuid := 'c5000000-0000-0000-0000-00000000000d';
  st_tr1   uuid := 'c5000000-0000-0000-0000-000000000011';
  st_b_owner uuid := 'c6000000-0000-0000-0000-00000000000f';

  plan_month uuid;
  m1 uuid; m2 uuid;
  dev_a1 uuid; hash_a1 text;
  result jsonb;
  stock public.card_stock%rowtype;
  mcard public.member_cards%rowtype;
  today_a date;
  n integer;
  t text;
  holder uuid;
  kind text;
  failed boolean;
  msg text;
begin
  -- fixtures ------------------------------------------------------------------
  insert into public.orgs (id, name, slug) values
    (org_a, 'Chi Fitness', 'chi-fitness-test'),
    (org_b, 'Psi Gyms', 'psi-gyms-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Chi One'),
    (br_b1, org_b, 'Psi One');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_owner, org_a, 'Chi Owner',   'owner@chi.test', 'owner',      '{}',         'active'),
    (st_mgr,   org_a, 'Chi Manager', 'mgr@chi.test',   'manager',    array[br_a1], 'active'),
    (st_desk,  org_a, 'Chi Desk',    'desk@chi.test',  'front_desk', array[br_a1], 'active'),
    (st_tr1,   org_a, 'Chi Trainer', 'tr1@chi.test',   'trainer',    array[br_a1], 'active'),
    (st_b_owner, org_b, 'Psi Owner', 'owner@psi.test', 'owner',      '{}',         'active');

  today_a := public.org_today(org_a);

  insert into public.membership_plans (org_id, name, plan_type, duration_days, price_paisa)
  values (org_a, 'Monthly', 'time', 30, 250000) returning id into plan_month;

  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Ramesh Thapa', '9830000001', st_owner) returning id into m1;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Sita Rai', '9830000002', st_owner) returning id into m2;
  insert into public.memberships
    (org_id, branch_id, member_id, plan_id, plan_name, plan_type,
     start_date, end_date, price_paisa, status)
  values (org_a, br_a1, m1, plan_month, 'Monthly', 'time',
          today_a - 5, today_a + 25, 250000, 'active');

  -- helpers --------------------------------------------------------------------
  assert public.parse_card_no('NO. 0004') = 4, 'parse: NO. 0004';
  assert public.parse_card_no('4') = 4, 'parse: 4';
  assert public.parse_card_no('04') = 4, 'parse: 04';
  assert public.parse_card_no(' 0004 ') = 4, 'parse: padded';
  assert public.parse_card_no('') is null, 'parse: empty';
  assert public.parse_card_no('abc') is null, 'parse: letters';
  assert public.parse_card_no('0') is null, 'parse: zero';
  assert public.parse_card_no('10000') is null, 'parse: too big';
  assert public.format_card_no(4) = '0004', 'format: 4';
  assert public.format_card_no(1456) = '1456', 'format: 1456';

  -- persona: owner numbers a run of cards --------------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  assert public.next_free_card_no() = 1, 'an empty org should start at card 1';

  result := public.create_card_stock_range(1, 10);
  assert (result ->> 'created')::integer = 10, format('range 1-10 created %s', result ->> 'created');
  assert (result ->> 'from_no')::integer = 1 and (result ->> 'to_no')::integer = 10, 'range bounds';
  assert (result ->> 'batch_id') is not null, 'a range should make a batch';
  select count(*) into n from public.card_stock where org_id = org_a;
  assert n = 10, format('expected 10 stock rows, found %s', n);
  select count(*) into n from public.card_stock where org_id = org_a and status = 'free' and card_uid is null;
  assert n = 10, 'new stock should be free with no chip';
  select count(distinct qr_token) into n from public.card_stock where org_id = org_a;
  assert n = 10, 'every card needs its own qr_token';
  -- the token is the printed card's link key: <number>_<8 random chars>
  select count(*) into n from public.card_stock
  where org_id = org_a and qr_token ~ '^[0-9]{4}_[a-z2-9]{8}$' and left(qr_token, 4) = lpad(card_no::text, 4, '0');
  assert n = 10, 'every token must be <card no>_<8 chars>';
  assert jsonb_array_length(result -> 'cards') = 10, format('the range should return every card: %s', result);
  select count(*) into n
  from jsonb_array_elements(result -> 'cards') c
  join public.card_stock cs on cs.org_id = org_a and cs.card_no = (c ->> 'card_no')::integer
  where cs.qr_token = c ->> 'token';
  assert n = 10, 'the tokens the range returned are not the stored ones';
  assert public.next_free_card_no() = 11, 'next free after 1-10 is 11';

  -- a number already printed cannot be printed again
  failed := false;
  begin
    perform public.create_card_stock_range(5, 12);
  exception when unique_violation then
    failed := true;
    get stacked diagnostics msg = message_text;
  end;
  assert failed, 'an overlapping range was accepted';
  assert msg like '%0005%', format('the collision should be named: %s', msg);

  -- not 500 at a time
  failed := false;
  begin
    perform public.create_card_stock_range(11, 700);
  exception when check_violation then failed := true;
  end;
  assert failed, 'a 690-card range was accepted';

  failed := false;
  begin
    perform public.create_card_stock_range(12, 11);
  exception when check_violation then failed := true;
  end;
  assert failed, 'a backwards range was accepted';

  -- the manager may number cards too; the desk may not
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_mgr::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';
  result := public.create_card_stock_range(11, 12);
  assert (result ->> 'created')::integer = 2, 'a manager could not number cards';

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin
    perform public.create_card_stock_range(13, 14);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'the front desk numbered cards';

  -- the desk links a chip to a printed number -----------------------------------
  stock := public.link_card_stock_uid(4, 'aa:bb:cc:dd:00:04');
  assert stock.card_uid = 'AABBCCDD0004', 'the chip uid was not normalised';
  assert stock.card_no = 4 and stock.status = 'free', 'linking changed more than the uid';

  -- one chip is one card
  failed := false;
  begin
    perform public.link_card_stock_uid(5, 'AABBCCDD0004');
  exception when unique_violation then
    failed := true;
    get stacked diagnostics msg = message_text;
  end;
  assert failed, 'one chip was linked to two numbers';
  assert msg like '%0004%', format('the other card should be named: %s', msg);

  -- the same chip on the same number is a no-op
  stock := public.link_card_stock_uid(4, 'AABBCCDD0004');
  assert stock.card_uid = 'AABBCCDD0004', 'relinking the same chip failed';

  -- a chip that is live for a staff member is not free stock
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  perform public.assign_staff_card(st_tr1, 'CCDDEEFF9999');
  failed := false;
  begin
    perform public.link_card_stock_uid(6, 'CCDDEEFF9999');
  exception when unique_violation then failed := true;
  end;
  assert failed, 'a staff member''s live card was linked as stock';

  -- a number that was never printed
  failed := false;
  begin
    perform public.link_card_stock_uid(99, 'AABBCCDD0099');
  exception when no_data_found then failed := true;
  end;
  assert failed, 'an unprinted number was linked';

  -- a bad uid
  failed := false;
  begin
    perform public.link_card_stock_uid(6, 'zz');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a bad uid was linked';

  -- hand card 0004 to a member by typing its number ------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  mcard := public.assign_card_stock_to_member(m1, 4);
  assert mcard.member_id = m1 and mcard.card_uid = 'AABBCCDD0004' and mcard.revoked_at is null,
    'assigning by number did not make the member card';
  assert mcard.assigned_by = st_desk, 'the assignment should be signed by the desk';

  select o.effective_status, o.member_id, o.holder_kind
    into t, holder, kind
  from public.card_stock_overview o where o.org_id = org_a and o.card_no = 4;
  assert t = 'assigned', format('card 0004 should read assigned, reads %s', t);
  assert holder = m1, 'card 0004 should point at its holder';
  assert kind = 'member', 'holder_kind should be member';

  select card_no into n from public.member_overview where id = m1;
  assert n = 4, format('member_overview.card_no should be 4, is %s', n);
  select card_no into n from public.member_overview where id = m2;
  assert n is null, 'a member without a card should have no card_no';

  -- the member already holds 0004: the same number again is a no-op
  mcard := public.assign_card_stock_to_member(m1, 4);
  select count(*) into n from public.member_cards where member_id = m1;
  assert n = 1, 'reassigning the same number made a second row';

  -- a card someone holds cannot be marked lost until it is taken back
  failed := false;
  begin
    perform public.set_card_stock_status(4, 'lost', 'Fell in the river');
  exception when restrict_violation then failed := true;
  end;
  assert failed, 'a card in a member''s hand was marked lost';

  -- take it back: stock is free again by itself
  perform public.revoke_member_card(m1, 'Returned');
  select effective_status into t from public.card_stock_overview where org_id = org_a and card_no = 4;
  assert t = 'free', format('a returned card should read free, reads %s', t);
  select card_no into n from public.member_overview where id = m1;
  assert n is null, 'a member who returned a card still shows its number';

  -- and the same chip and number go to the next member without relinking
  mcard := public.assign_card_stock_to_member(m2, 4);
  assert mcard.member_id = m2 and mcard.card_uid = 'AABBCCDD0004', 'a returned card could not be reused';
  perform public.revoke_member_card(m2, 'Returned');

  -- lost, then found
  stock := public.set_card_stock_status(4, 'lost', 'Fell in the river');
  assert stock.status = 'lost' and stock.status_reason = 'Fell in the river', 'lost was not recorded';
  select effective_status into t from public.card_stock_overview where org_id = org_a and card_no = 4;
  assert t = 'lost', 'overview should read lost';

  failed := false;
  begin
    perform public.assign_card_stock_to_member(m1, 4);
  exception when check_violation then failed := true;
  end;
  assert failed, 'a lost card was handed out';

  -- nor by its chip through the plain uid path: the stock row is the truth
  failed := false;
  begin
    perform public.assign_member_card(m1, 'AABBCCDD0004');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a lost card''s chip was assigned by uid';

  failed := false;
  begin
    perform public.set_card_stock_status(5, 'lost', '  ');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a card was marked lost with no reason';

  stock := public.set_card_stock_status(4, 'free', null);
  assert stock.status = 'free' and stock.status_reason is null, 'found did not clear the reason';

  -- a number with no chip yet: refused with a hint, then linked and assigned in one go
  failed := false;
  begin
    perform public.assign_card_stock_to_member(m1, 7);
  exception when check_violation then
    failed := true;
    get stacked diagnostics msg = message_text;
  end;
  assert failed, 'a chipless number was assigned';
  assert msg like '%0007%' and msg ilike '%chip%', format('the hint should name the card: %s', msg);

  -- the chip taps a reader first (so the desk can pick it from the inbox)
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  result := public.register_device(br_a1, 'Door one');
  dev_a1 := (result ->> 'device_id')::uuid;
  hash_a1 := encode(extensions.digest(result ->> 'key', 'sha256'), 'hex');

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  execute 'set local role service_role';
  result := public.rfid_check_in(hash_a1, 'AABBCCDD0007');
  assert result ->> 'reason' = 'unknown_card', 'a fresh chip should be unknown';
  select count(*) into n from public.unassigned_card_scans where card_uid = 'AABBCCDD0007';
  assert n = 1, 'the fresh chip did not land in the inbox';

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  mcard := public.assign_card_stock_to_member(m1, 7, 'AABBCCDD0007');
  assert mcard.member_id = m1 and mcard.card_uid = 'AABBCCDD0007', 'link-and-assign failed';
  select card_uid into t from public.card_stock where org_id = org_a and card_no = 7;
  assert t = 'AABBCCDD0007', 'link-and-assign did not store the chip on the stock row';
  select count(*) into n from public.unassigned_card_scans where card_uid = 'AABBCCDD0007';
  assert n = 0, 'link-and-assign left the chip in the inbox';

  -- a uid that disagrees with the chip already on the number is refused
  failed := false;
  begin
    perform public.assign_card_stock_to_member(m2, 7, 'AABBCCDD0070');
  exception when unique_violation or check_violation then failed := true;
  end;
  assert failed, 'a different chip was accepted for a linked number';

  -- the door now knows card 0007 as m1
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  execute 'set local role service_role';
  result := public.rfid_check_in(hash_a1, 'AABBCCDD0007');
  assert result ->> 'member_name' = 'Ramesh Thapa', format('the door did not recognise card 0007: %s', result);

  -- immutability and direct writes -------------------------------------------------
  execute 'reset role';
  failed := false;
  begin
    update public.card_stock set card_no = 99 where org_id = org_a and card_no = 4;
  exception when restrict_violation then failed := true;
  end;
  assert failed, 'a printed number was renumbered';

  failed := false;
  begin
    update public.card_stock set qr_token = 'x' where org_id = org_a and card_no = 4;
  exception when restrict_violation then failed := true;
  end;
  assert failed, 'a qr token was changed';

  -- any insert path gets a token; one that disagrees with its number is refused
  insert into public.card_stock (org_id, card_no) values (org_a, 600) returning qr_token into t;
  assert t ~ '^0600_[a-z2-9]{8}$', format('a direct insert should get a token: %s', t);
  failed := false;
  begin
    insert into public.card_stock (org_id, card_no, qr_token) values (org_a, 601, '0602_abcdefgh');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a token for another card number was accepted';
  failed := false;
  begin
    insert into public.card_stock (org_id, card_no, qr_token) values (org_a, 601, '0601');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a bare number was accepted as a token';
  delete from public.card_stock where org_id = org_a and card_no = 600;

  -- card 0007 is in m1's hand: its chip cannot be swapped underneath
  failed := false;
  begin
    update public.card_stock set card_uid = 'AABBCCDD0070' where org_id = org_a and card_no = 7;
  exception when restrict_violation then failed := true;
  end;
  assert failed, 'a live card''s chip was swapped';

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin
    insert into public.card_stock (org_id, card_no) values (org_a, 500);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a signed-in user inserted stock directly';
  failed := false;
  begin
    delete from public.card_stock where org_id = org_a;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a signed-in user deleted stock directly';

  -- a trainer may read the stock but not touch it
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_tr1::text,
    'staff_role', 'trainer', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.card_stock_overview where org_id = org_a;
  assert n = 12, format('a trainer should see the 12 cards, saw %s', n);
  failed := false;
  begin
    perform public.link_card_stock_uid(5, 'AABBCCDD0005');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a trainer linked a chip';
  failed := false;
  begin
    perform public.set_card_stock_status(5, 'lost', 'x');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a trainer marked a card lost';

  -- another org sees none of it ------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.card_stock;
  assert n = 0, 'org B read org A''s stock';
  select count(*) into n from public.card_stock_overview;
  assert n = 0, 'org B read org A''s stock overview';
  assert public.next_free_card_no() = 1, 'org B''s numbering should start at 1';

  failed := false;
  begin
    perform public.link_card_stock_uid(4, 'AABBCCDD0004');
  exception when no_data_found then failed := true;
  end;
  assert failed, 'org B linked org A''s card';

  -- nor probe whose chips are live over there
  assert public.card_uid_holder_kind(org_a, 'AABBCCDD0007') is null,
    'org B learnt that a chip is live in org A';
  failed := false;
  begin
    perform public.card_uid_holder_kind_internal(org_a, 'AABBCCDD0007');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a signed-in user called the unguarded holder lookup';

  -- the qr token is not on the screen view
  select count(*) into n from information_schema.columns
  where table_schema = 'public' and table_name = 'card_stock_overview' and column_name = 'qr_token';
  assert n = 0, 'card_stock_overview exposes qr_token';

  -- and its own 0004 is a different card
  result := public.create_card_stock_range(1, 5);
  assert (result ->> 'created')::integer = 5, 'org B could not number its own cards';
  stock := public.link_card_stock_uid(4, 'BBBBCCCC0004');
  assert stock.org_id = org_b, 'org B''s card 0004 landed in the wrong org';

  -- teardown -------------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'card stock: all assertions passed';
end $$;
