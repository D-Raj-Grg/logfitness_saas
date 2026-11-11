-- The public balance page and renewal requests. A member scans the QR on
-- their card (…/balance?c=0004_k3x9q2mf, a random per-card token); the
-- public-balance Edge Function asks public_card_balance() with the service role
-- and shows masked name, plan and days left; "Request renewal" calls
-- public_renewal_request(). Both find the card by token only -- a printed
-- number is no key. Staff then see the request and renew at the desk, which
-- closes it by itself.
--
-- Seeds two orgs, drives the real RPCs as real personas, asserts, then removes
-- its fixtures. A failed assertion aborts. The public RPCs are called as
-- `service_role` with no JWT claims, the same position the Edge Function is in.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/public_balance.sql

do $$
declare
  org_a uuid := 'c7c7c7c7-1111-1111-1111-111111111111';
  org_b uuid := 'c8c8c8c8-2222-2222-2222-222222222222';
  br_a1 uuid := 'c7b00000-0000-0000-0000-000000000001';
  br_a2 uuid := 'c7b00000-0000-0000-0000-000000000002';
  br_b1 uuid := 'c8b00000-0000-0000-0000-000000000001';
  st_owner uuid := 'c7000000-0000-0000-0000-00000000000f';
  st_desk  uuid := 'c7000000-0000-0000-0000-00000000000d';
  st_desk2 uuid := 'c7000000-0000-0000-0000-00000000000e';
  st_tr1   uuid := 'c7000000-0000-0000-0000-000000000011';
  st_b_owner uuid := 'c8000000-0000-0000-0000-00000000000f';

  plan_month uuid;
  m_active uuid; m_expired uuid; m_gone uuid; m_nocard uuid;
  req_id uuid;
  result jsonb;
  made jsonb;
  tok1 text; tok2 text; tok3 text; tok4 text; tok6 text;
  req public.renewal_requests%rowtype;
  today_a date;
  n integer;
  t text;
  failed boolean;
begin
  -- fixtures ------------------------------------------------------------------
  insert into public.orgs (id, name, slug) values
    (org_a, 'Omega Fit', 'omega-fit-test'),
    (org_b, 'Rho Gyms', 'rho-gyms-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Omega One'),
    (br_a2, org_a, 'Omega Two'),
    (br_b1, org_b, 'Rho One');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_owner, org_a, 'Omega Owner',   'owner@omega.test', 'owner',      '{}',         'active'),
    (st_desk,  org_a, 'Omega Desk',    'desk@omega.test',  'front_desk', array[br_a1], 'active'),
    (st_desk2, org_a, 'Omega Desk Two','desk2@omega.test', 'front_desk', array[br_a2], 'active'),
    (st_tr1,   org_a, 'Omega Trainer', 'tr1@omega.test',   'trainer',    array[br_a1], 'active'),
    (st_b_owner, org_b, 'Rho Owner',   'owner@rho.test',   'owner',      '{}',         'active');

  today_a := public.org_today(org_a);

  insert into public.membership_plans (org_id, name, plan_type, duration_days, price_paisa)
  values (org_a, 'Monthly', 'time', 30, 250000) returning id into plan_month;

  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Ramesh Thapa', '9830000001', st_owner) returning id into m_active;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Sita Rai', '9830000002', st_owner) returning id into m_expired;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'Gone Member', '9830000003', st_owner) returning id into m_gone;
  insert into public.members (org_id, home_branch_id, full_name, phone, created_by)
  values (org_a, br_a1, 'No Card', '9830000004', st_owner) returning id into m_nocard;

  insert into public.memberships
    (org_id, branch_id, member_id, plan_id, plan_name, plan_type, start_date, end_date, price_paisa, status)
  values
    (org_a, br_a1, m_active,  plan_month, 'Monthly', 'time', today_a - 18, today_a + 12, 250000, 'active'),
    (org_a, br_a1, m_expired, plan_month, 'Monthly', 'time', today_a - 33, today_a - 3,  250000, 'expired'),
    (org_a, br_a1, m_gone,    plan_month, 'Monthly', 'time', today_a - 18, today_a + 12, 250000, 'active');

  -- masking is a pure function
  assert public.mask_name('Ramesh Thapa') = 'R•••• T••••', format('mask: %s', public.mask_name('Ramesh Thapa'));
  assert public.mask_name('Sita') = 'S•••', format('mask: %s', public.mask_name('Sita'));
  assert public.mask_name('Al') = 'A••', format('mask: %s', public.mask_name('Al'));
  assert public.mask_name('  Hari  Bahadur   Khadka ') = 'H••• B•••• K••••',
    format('mask: %s', public.mask_name('  Hari  Bahadur   Khadka '));
  assert public.mask_name('') = '', 'mask: empty';

  -- the desk numbers cards and hands them out -----------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  made := public.create_card_stock_range(1, 10);
  perform public.assign_card_stock_to_member(m_active,  1, 'AABB00000001');
  perform public.assign_card_stock_to_member(m_expired, 2, 'AABB00000002');
  perform public.link_card_stock_uid(4, 'AABB00000004');          -- linked, nobody holds it
  perform public.assign_card_stock_to_member(m_gone,    6, 'AABB00000006');

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  update public.members set archived_at = now() where id = m_gone;

  -- the range hands back every card's token, and it is what is stored
  assert jsonb_array_length(made -> 'cards') = 10, format('range should return 10 cards: %s', made);
  select c ->> 'token' into tok1 from jsonb_array_elements(made -> 'cards') c where (c ->> 'card_no')::integer = 1;
  select c ->> 'token' into tok2 from jsonb_array_elements(made -> 'cards') c where (c ->> 'card_no')::integer = 2;
  select c ->> 'token' into tok3 from jsonb_array_elements(made -> 'cards') c where (c ->> 'card_no')::integer = 3;
  select c ->> 'token' into tok4 from jsonb_array_elements(made -> 'cards') c where (c ->> 'card_no')::integer = 4;
  select c ->> 'token' into tok6 from jsonb_array_elements(made -> 'cards') c where (c ->> 'card_no')::integer = 6;
  assert tok1 ~ '^0001_[a-z2-9]{8}$', format('token shape: %s', tok1);
  select count(*) into n from public.card_stock where org_id = org_a and qr_token = tok1 and card_no = 1;
  assert n = 1, 'the returned token is not the stored one';

  -- the public page, as the Edge Function ---------------------------------------
  execute 'set local role service_role';

  result := public.public_card_balance('no-such-gym', tok1);
  assert result ->> 'result' = 'org_not_found', format('unknown org: %s', result);

  -- a number is no key: not as the old card_no, not padded, not with a guessed tail
  result := public.public_card_balance('omega-fit-test', '0099_aaaaaaaa');
  assert result ->> 'result' = 'card_not_found' and not (result ? 'card_no'),
    format('unknown token: %s', result);
  result := public.public_card_balance('omega-fit-test', '0001');
  assert result ->> 'result' = 'card_not_found', format('a bare card number worked as a token: %s', result);
  result := public.public_card_balance('omega-fit-test', '0001_');
  assert result ->> 'result' = 'card_not_found', format('an empty tail worked: %s', result);
  result := public.public_card_balance('omega-fit-test', left(tok1, 5) || 'zzzzzzzz');
  assert result ->> 'result' = 'card_not_found', format('right number, guessed tail: %s', result);
  result := public.public_card_balance('omega-fit-test', null);
  assert result ->> 'result' = 'card_not_found', format('null token: %s', result);
  -- and another gym's slug does not open this gym's card
  result := public.public_card_balance('rho-gyms-test', tok1);
  assert result ->> 'result' = 'card_not_found', format('org A token under org B slug: %s', result);

  result := public.public_card_balance('omega-fit-test', tok3);
  assert result ->> 'result' = 'card_unassigned' and result ->> 'card_no' = '0003',
    format('chipless card: %s', result);
  result := public.public_card_balance('omega-fit-test', tok4);
  assert result ->> 'result' = 'card_unassigned', format('card on the shelf: %s', result);
  result := public.public_card_balance('omega-fit-test', tok6);
  assert result ->> 'result' = 'card_unassigned', format('archived member''s card: %s', result);

  result := public.public_card_balance('omega-fit-test', tok1);
  assert result ->> 'result' = 'ok', format('active card: %s', result);
  assert result ->> 'card_no' = '0001', 'card_no should be zero-padded text';
  assert result ->> 'name_masked' = 'R•••• T••••', format('name should be masked: %s', result ->> 'name_masked');
  assert result ->> 'plan_name' = 'Monthly', 'plan name';
  assert result ->> 'status' = 'active', format('status should be active: %s', result ->> 'status');
  assert (result ->> 'days_left')::integer = 12, format('days_left should be 12: %s', result ->> 'days_left');
  assert (result ->> 'ends_on')::date = today_a + 12, 'ends_on';
  assert (result ->> 'renewal_pending')::boolean = false, 'no request yet';
  assert not (result ? 'phone') and not (result ? 'due_paisa') and not (result ? 'member_code')
     and not (result ? 'full_name') and not (result ? 'member_id'),
    format('the public answer leaks a private field: %s', result);

  result := public.public_card_balance('omega-fit-test', tok2);
  assert result ->> 'result' = 'ok' and result ->> 'status' = 'expired'
     and (result ->> 'days_left')::integer = -3,
    format('expired card: %s', result);

  -- asking to renew ---------------------------------------------------------------
  result := public.public_renewal_request('no-such-gym', tok1, null, null);
  assert result ->> 'result' = 'org_not_found', format('renew, unknown org: %s', result);
  result := public.public_renewal_request('omega-fit-test', '0099_aaaaaaaa', null, null);
  assert result ->> 'result' = 'card_not_found', format('renew, unknown token: %s', result);
  result := public.public_renewal_request('omega-fit-test', '0001', null, null);
  assert result ->> 'result' = 'card_not_found', format('renew, bare number: %s', result);
  result := public.public_renewal_request('rho-gyms-test', tok1, null, null);
  assert result ->> 'result' = 'card_not_found', format('renew, org A token under org B slug: %s', result);
  result := public.public_renewal_request('omega-fit-test', tok4, null, null);
  assert result ->> 'result' = 'card_unassigned', format('renew, shelf card: %s', result);

  result := public.public_renewal_request('omega-fit-test', tok1, ' +977 98-3000 0001 ', '  Please call after 5  ');
  assert result ->> 'result' = 'ok', format('renew: %s', result);

  -- again, right away: refused, and still one row
  result := public.public_renewal_request('omega-fit-test', tok1, null, null);
  assert result ->> 'result' = 'too_soon', format('second ask: %s', result);

  result := public.public_card_balance('omega-fit-test', tok1);
  assert (result ->> 'renewal_pending')::boolean, 'the page should know a request is pending';

  -- the staff side ---------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  select * into req from public.renewal_requests where member_id = m_active;
  assert found, 'the desk cannot see the request';
  assert req.status = 'pending' and req.request_count = 1, 'the request should be pending, asked once';
  assert req.phone = '+9779830000001', format('phone should be cleaned: %s', req.phone);
  assert req.note = 'Please call after 5', format('note should be trimmed: %s', req.note);
  assert req.card_stock_id is not null, 'the request should remember the card';
  req_id := req.id;

  select count(*) into n from public.renewal_requests where org_id = org_a and status = 'pending';
  assert n = 1, format('pending count should be 1, is %s', n);

  -- ten minutes later the member may ask again: same row, counted
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  update public.renewal_requests set last_requested_at = now() - interval '11 minutes' where id = req_id;
  execute 'set local role service_role';
  result := public.public_renewal_request('omega-fit-test', tok1, null, 'still waiting');
  assert result ->> 'result' = 'ok', format('third ask after 10 min: %s', result);
  execute 'reset role';
  select * into req from public.renewal_requests where id = req_id;
  assert req.request_count = 2 and req.status = 'pending', format('repeat ask should bump the count: %s', req.request_count);
  -- a stranger with the card link must not be able to rewrite what the
  -- member first said; the first phone and note stay
  assert req.note = 'Please call after 5', format('a repeat ask rewrote the note: %s', req.note);
  assert req.phone = '+9779830000001', format('a repeat ask rewrote the phone: %s', req.phone);
  select count(*) into n from public.renewal_requests where member_id = m_active;
  assert n = 1, 'a repeat ask made a second row';

  -- a desk at another branch neither sees nor handles it
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk2::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a2::text)
  )::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.renewal_requests;
  assert n = 0, format('a desk at another branch read %s renewal requests', n);
  failed := false;
  begin
    perform public.handle_renewal_request(req_id, 'rejected', 'no');
  exception when no_data_found then failed := true;
  end;
  assert failed, 'a desk at another branch handled the request';
  execute 'reset role';

  -- a trainer may not handle it; the desk may, once
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_tr1::text,
    'staff_role', 'trainer', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin
    perform public.handle_renewal_request(req_id, 'rejected', 'no');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a trainer handled a renewal request';

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';
  req := public.handle_renewal_request(req_id, 'rejected', 'Member changed their mind');
  assert req.status = 'rejected' and req.handled_by = st_desk and req.handled_at is not null
     and req.handled_note = 'Member changed their mind',
    'rejecting did not record who and why';

  failed := false;
  begin
    perform public.handle_renewal_request(req_id, 'done', null);
  exception when check_violation then failed := true;
  end;
  assert failed, 'a handled request was handled again';

  -- the page no longer says pending; the member can ask afresh
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  execute 'set local role service_role';
  result := public.public_card_balance('omega-fit-test', tok1);
  assert (result ->> 'renewal_pending')::boolean = false, 'a rejected request still shows pending';

  -- renewing at the desk closes a pending request by itself
  result := public.public_renewal_request('omega-fit-test', tok2, null, null);
  assert result ->> 'result' = 'ok', format('expired member asks: %s', result);

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';
  perform public.renew_membership(m_expired, plan_month, br_a1, today_a, 0, 250000, 'cash', null, null, null, null);

  select * into req from public.renewal_requests where member_id = m_expired;
  assert req.status = 'done' and req.handled_by = st_desk and req.handled_note = 'Renewed at the desk',
    format('renewing did not close the request: %s / %s', req.status, req.handled_note);

  -- direct writes are not a thing
  failed := false;
  begin
    insert into public.renewal_requests (org_id, member_id) values (org_a, m_nocard);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a signed-in user inserted a renewal request directly';
  failed := false;
  begin
    update public.renewal_requests set status = 'pending' where id = req_id;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a signed-in user edited a renewal request directly';

  -- the public RPCs are for the Edge Function only
  failed := false;
  begin
    perform public.public_card_balance('omega-fit-test', tok1);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a signed-in user called public_card_balance';
  failed := false;
  begin
    perform public.public_renewal_request('omega-fit-test', tok1, null, null);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a signed-in user called public_renewal_request';

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  execute 'set local role anon';
  failed := false;
  begin
    perform public.public_card_balance('omega-fit-test', tok1);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'anon called public_card_balance';
  failed := false;
  begin
    perform public.mask_name('x');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'anon called mask_name';
  failed := false;
  begin
    perform * from public.public_card_lookup_by_token('omega-fit-test', tok1);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'anon called public_card_lookup_by_token';
  execute 'reset role';
  assert to_regprocedure('public.public_card_balance(text, integer)') is null,
    'the number-keyed public_card_balance is still there';
  assert to_regprocedure('public.public_renewal_request(text, integer, text, text)') is null,
    'the number-keyed public_renewal_request is still there';

  -- another org sees none of it ----------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.renewal_requests;
  assert n = 0, 'org B read org A''s renewal requests';
  failed := false;
  begin
    perform public.handle_renewal_request(req_id, 'done', null);
  exception when no_data_found then failed := true;
  end;
  assert failed, 'org B handled org A''s request';

  -- a flood of first requests across an org is throttled ------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  insert into public.renewal_requests (org_id, member_id, status, handled_at, handled_note)
  select org_a, m_nocard, 'done', now(), 'flood fixture' from generate_series(1, 30);
  execute 'set local role service_role';
  result := public.public_renewal_request('omega-fit-test', tok1, null, null);
  assert result ->> 'result' = 'too_soon', format('the org-wide hourly cap did not hold: %s', result);
  select count(*) into n from public.renewal_requests where member_id = m_active and status = 'pending';
  assert n = 0, 'a request was written past the hourly cap';
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.renewal_requests where handled_note = 'flood fixture';

  -- the balance_url preference ------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';
  result := public.set_org_setting('balance_url', to_jsonb('https://lordofgyms.com/balance'::text));
  assert result ->> 'balance_url' = 'https://lordofgyms.com/balance', 'balance_url was not stored';
  failed := false;
  begin
    perform public.set_org_setting('balance_url', to_jsonb('http://lordofgyms.com/balance'::text));
  exception when invalid_parameter_value then failed := true;
  end;
  assert failed, 'a plain-http balance_url was accepted';
  failed := false;
  begin
    perform public.set_org_setting('balance_url', to_jsonb('https://lordofgyms.com/balance?card_no=1'::text));
  exception when invalid_parameter_value then failed := true;
  end;
  assert failed, 'a balance_url that already carries card_no was accepted';
  failed := false;
  begin
    perform public.set_org_setting('balance_url', to_jsonb('https://lordofgyms.com/balance?org=x&c=0001_abcdefgh'::text));
  exception when invalid_parameter_value then failed := true;
  end;
  assert failed, 'a balance_url that already carries c was accepted';
  result := public.set_org_setting('balance_url', to_jsonb('https://lordofgyms.com/balance?org=x&cc=1'::text));
  assert result ->> 'balance_url' like '%cc=1', 'a different parameter that merely starts with c was refused';
  result := public.set_org_setting('balance_url', 'null'::jsonb);
  assert result -> 'balance_url' = 'null'::jsonb, 'balance_url could not be cleared';

  -- teardown -------------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'public balance: all assertions passed';
end $$;
