-- Phase 6 gate: the member principal, exercised end to end.
--
-- Covers the invite/link handshake, current_member(), the claim shape the
-- access-token hook produces, and -- the part that matters -- the negative
-- tests. A member must see their own rows and nothing else, and the staff
-- policies must keep working now that they carry an extra condition.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/member_app.sql

do $$
declare
  org_a uuid := '55555555-5555-5555-5555-555555555555';
  org_b uuid := '66666666-6666-6666-6666-666666666666';
  br_a1 uuid := 'eeeeeee1-0000-0000-0000-000000000001';
  br_b1 uuid := 'fffffff1-0000-0000-0000-000000000001';
  st_a_desk uuid := 'e0000000-0000-0000-0000-00000000000d';
  st_b_desk uuid := 'f0000000-0000-0000-0000-00000000000d';

  user_alice uuid := 'a1000000-0000-0000-0000-0000000000a1';
  user_bob uuid := 'b1000000-0000-0000-0000-0000000000b1';
  user_nobody uuid := 'c1000000-0000-0000-0000-0000000000c1';
  user_impostor uuid := 'd1000000-0000-0000-0000-0000000000d1';

  mem_alice uuid;
  mem_carol uuid;
  mem_bob uuid;
  plan_a uuid;
  ship_alice uuid;
  inv_alice uuid;
  pay_alice uuid;

  n integer;
  txt text;
  failed boolean;
  linked uuid;
  claims_alice jsonb;
  token jsonb;
  verdict jsonb;
begin
  -- fixtures, as the owning role so RLS is out of the way. The deletes let the
  -- file be re-run after a failed assertion aborted a previous attempt.
  delete from public.orgs where id in (org_a, org_b);
  delete from auth.users where id in (user_alice, user_bob, user_nobody, user_impostor);

  insert into public.orgs (id, name, slug) values
    (org_a, 'Epsilon Fitness', 'epsilon-fitness-test'),
    (org_b, 'Zeta Gyms', 'zeta-gyms-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Epsilon Lazimpat'),
    (br_b1, org_b, 'Zeta Kalanki');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_a_desk, org_a, 'Epsilon Desk', 'desk@epsilon.test', 'front_desk', array[br_a1], 'active'),
    (st_b_desk, org_b, 'Zeta Desk',    'desk@zeta.test',    'front_desk', array[br_b1], 'active');

  -- Auth accounts for the two members who get app access, and one account that
  -- signs in with no invitation waiting at all.
  -- email_confirmed_at is set deliberately: link_member_account() refuses an
  -- unconfirmed address, and section 13 below is the test for that.
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (user_alice,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice@epsilon.test', now(), now(), now()),
    (user_bob,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob@zeta.test',      now(), now(), now()),
    (user_nobody, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nobody@nowhere.test',now(), now(), now());

  insert into public.members (org_id, home_branch_id, member_code, full_name, phone, joined_on)
  values (org_a, br_a1, 'M90001', 'Alice Rai', '9800000001', public.org_today(org_a))
  returning id into mem_alice;

  insert into public.members (org_id, home_branch_id, member_code, full_name, phone, joined_on)
  values (org_a, br_a1, 'M90002', 'Carol Thapa', '9800000002', public.org_today(org_a))
  returning id into mem_carol;

  insert into public.members (org_id, home_branch_id, member_code, full_name, phone, joined_on)
  values (org_b, br_b1, 'M90003', 'Bob Shrestha', '9800000003', public.org_today(org_b))
  returning id into mem_bob;

  insert into public.membership_plans
    (org_id, name, plan_type, duration_days, price_paisa, branch_ids)
  values (org_a, 'Test Monthly', 'time', 30, 200000, array[br_a1])
  returning id into plan_a;

  insert into public.memberships
    (org_id, branch_id, member_id, plan_id, plan_name, plan_type,
     start_date, end_date, price_paisa)
  values (org_a, br_a1, mem_alice, plan_a, 'Test Monthly', 'time',
          public.org_today(org_a), public.org_today(org_a) + 30, 200000)
  returning id into ship_alice;

  insert into public.invoices
    (org_id, branch_id, member_id, membership_id, invoice_no,
     subtotal_paisa, discount_paisa, total_paisa, issued_on)
  values (org_a, br_a1, mem_alice, ship_alice, 'INV900001',
          200000, 0, 200000, public.org_today(org_a))
  returning id into inv_alice;

  insert into public.payments
    (org_id, branch_id, member_id, membership_id, invoice_id,
     amount_paisa, method, collected_by)
  values (org_a, br_a1, mem_alice, ship_alice, inv_alice, 200000, 'cash', st_a_desk)
  returning id into pay_alice;

  insert into public.attendance (org_id, branch_id, member_id, membership_id, method, checked_in_by)
  values (org_a, br_a1, mem_alice, ship_alice, 'manual', st_a_desk);

  insert into public.attendance (org_id, branch_id, member_id, method, checked_in_by)
  values (org_a, br_a1, mem_carol, 'manual', st_a_desk);

  -- 1. staff invite a member to the app -------------------------------------

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  perform public.invite_member(mem_alice, 'Alice@Epsilon.test');

  execute 'reset role';

  select count(*) into n
  from public.members
  where id = mem_alice
    and email = 'alice@epsilon.test'
    and invited_at is not null
    and invited_by = st_a_desk;
  if n <> 1 then
    raise exception 'invite_member did not stamp the invitation (%)', n;
  end if;

  -- 2. a member of another gym cannot invite this one -----------------------

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_b1::text)
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.invite_member(mem_carol, 'carol@epsilon.test');
  exception when others then
    failed := true;
  end;
  if not failed then
    raise exception 'a front desk in org B invited a member of org A';
  end if;

  execute 'reset role';

  -- 3. the invited account links itself -------------------------------------

  perform set_config('request.jwt.claims', json_build_object(
    'sub', user_alice::text, 'role', 'authenticated'
  )::text, true);
  execute 'set local role authenticated';

  linked := public.link_member_account();
  if linked <> mem_alice then
    raise exception 'link_member_account linked the wrong member';
  end if;

  -- idempotent: a second call returns the same row rather than raising
  if public.link_member_account() <> mem_alice then
    raise exception 'link_member_account is not idempotent';
  end if;

  execute 'reset role';

  select count(*) into n
  from public.members
  where id = mem_alice and auth_user_id = user_alice and accepted_at is not null;
  if n <> 1 then
    raise exception 'the link did not land on the member row';
  end if;

  -- 4. an account with no invitation cannot link ----------------------------

  perform set_config('request.jwt.claims', json_build_object(
    'sub', user_nobody::text, 'role', 'authenticated'
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.link_member_account();
  exception when others then
    failed := true;
  end;
  if not failed then
    raise exception 'an uninvited account linked itself to a member';
  end if;

  execute 'reset role';

  -- 5. current_member() reads before any claims exist -----------------------

  perform set_config('request.jwt.claims', json_build_object(
    'sub', user_alice::text, 'role', 'authenticated'
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.current_member();
  if n <> 1 then
    raise exception 'current_member() returned % rows for a linked member', n;
  end if;

  select cm.full_name into txt from public.current_member() cm;
  if txt <> 'Alice Rai' then
    raise exception 'current_member() returned the wrong member (%)', txt;
  end if;

  -- ... and a claimless session sees nothing through RLS.
  select count(*) into n from public.members;
  if n <> 0 then
    raise exception 'a claimless session read % member rows', n;
  end if;

  execute 'reset role';

  -- 6. the hook produces a member claim set ---------------------------------

  claims_alice := public.custom_access_token_hook(
    jsonb_build_object(
      'user_id', user_alice::text,
      'claims', jsonb_build_object('role', 'authenticated')
    )
  ) -> 'claims';

  if claims_alice ->> 'role' <> 'authenticated' then
    raise exception 'the hook overwrote the PostgREST role claim (%)', claims_alice ->> 'role';
  end if;
  if (claims_alice ->> 'member_id')::uuid <> mem_alice then
    raise exception 'the hook did not stamp member_id';
  end if;
  if (claims_alice ->> 'org_id')::uuid <> org_a then
    raise exception 'the hook did not stamp org_id';
  end if;
  if claims_alice ? 'staff_role' then
    raise exception 'a member token carries a staff_role claim';
  end if;
  if (claims_alice -> 'branch_ids' ->> 0)::uuid <> br_a1 then
    raise exception 'a member token does not carry its home branch';
  end if;

  -- 7. what a member can read -----------------------------------------------

  perform set_config('request.jwt.claims', json_build_object(
    'sub', user_alice::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', mem_alice::text,
    'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.members;
  if n <> 1 then
    raise exception 'a member read % member rows, expected only their own', n;
  end if;

  select count(*) into n from public.members where id = mem_carol;
  if n <> 0 then
    raise exception 'a member read another member of the same gym';
  end if;

  select count(*) into n from public.memberships;
  if n <> 1 then
    raise exception 'a member read % membership rows', n;
  end if;

  select count(*) into n from public.invoices;
  if n <> 1 then
    raise exception 'a member read % invoice rows', n;
  end if;

  select count(*) into n from public.payments;
  if n <> 1 then
    raise exception 'a member read % payment rows', n;
  end if;

  select count(*) into n from public.attendance;
  if n <> 1 then
    raise exception 'a member read % attendance rows, expected only their own', n;
  end if;

  select count(*) into n from public.orgs;
  if n <> 1 then
    raise exception 'a member read % org rows', n;
  end if;

  select count(*) into n from public.branches;
  if n <> 1 then
    raise exception 'a member read % branch rows', n;
  end if;

  -- 8. what a member must never read ----------------------------------------

  select count(*) into n from public.staff;
  if n <> 0 then
    raise exception 'a member read % staff rows', n;
  end if;

  select count(*) into n from public.membership_plans;
  if n <> 0 then
    raise exception 'a member read the plan catalogue (% rows)', n;
  end if;

  select count(*) into n from public.audit_log;
  if n <> 0 then
    raise exception 'a member read % audit rows', n;
  end if;

  -- 9. a member writes nothing directly -------------------------------------

  failed := false;
  begin
    update public.members set full_name = 'Alice Renamed' where id = mem_alice;
    if not found then
      failed := true;
    end if;
  exception when others then
    failed := true;
  end;
  if not failed then
    raise exception 'a member edited their own row directly';
  end if;

  failed := false;
  begin
    insert into public.payments (org_id, branch_id, member_id, amount_paisa, method)
    values (org_a, br_a1, mem_alice, 100, 'cash');
  exception when others then
    failed := true;
  end;
  if not failed then
    raise exception 'a member inserted a payment';
  end if;

  -- 10. QR: a member mints their own token, and cannot verify one -----------

  token := public.mint_qr_token();
  if (token ->> 'member_id')::uuid <> mem_alice then
    raise exception 'mint_qr_token minted for the wrong member';
  end if;

  verdict := public.verify_qr_token(token ->> 'token');
  if (verdict ->> 'valid')::boolean then
    raise exception 'a member verified a QR token';
  end if;

  execute 'reset role';

  -- 11. staff still see the whole roster, and the scanner still works --------

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.members;
  if n <> 2 then
    raise exception 'the front desk reads % members, expected 2', n;
  end if;

  verdict := public.verify_qr_token(token ->> 'token');
  if not (verdict ->> 'valid')::boolean then
    raise exception 'the front desk could not verify a member token (%)', verdict ->> 'reason';
  end if;

  -- a member of another gym is still invisible
  select count(*) into n from public.members where id = mem_bob;
  if n <> 0 then
    raise exception 'the front desk read a member of another gym';
  end if;

  execute 'reset role';

  -- 12. one email invited by two gyms is refused, not guessed ---------------

  update public.members set email = 'bob@zeta.test', invited_at = now()
  where id = mem_bob;
  update public.members set email = 'bob@zeta.test', invited_at = now()
  where id = mem_carol;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', user_bob::text, 'role', 'authenticated'
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.link_member_account();
  exception when others then
    failed := true;
  end;
  if not failed then
    raise exception 'an ambiguous invitation was linked to a guessed gym';
  end if;

  execute 'reset role';

  -- 13. an unconfirmed email cannot claim a membership -----------------------
  --
  -- The email address is the only thing tying an account to a member record,
  -- so signing up as someone else's address must not be enough to take it.

  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values (user_impostor, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'carol@epsilon.test', null, now(), now());

  update public.members set email = 'carol@epsilon.test', invited_at = now(), auth_user_id = null
  where id = mem_carol;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', user_impostor::text, 'role', 'authenticated'
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.link_member_account();
  exception when others then
    failed := true;
  end;
  if not failed then
    raise exception 'an account with an unconfirmed email claimed a membership';
  end if;

  execute 'reset role';

  -- 14. member photos are per-member, not per-org ----------------------------
  --
  -- The storage policy predicate, evaluated directly: storage.objects cannot be
  -- seeded from here (storage.protect_delete() blocks the teardown), and the
  -- predicate is the whole of the access decision.

  perform set_config('request.jwt.claims', json_build_object(
    'sub', user_alice::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', mem_alice::text,
    'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  if not (
    public.is_org_member(public.storage_object_org(org_a || '/' || mem_alice || '/face.jpg'))
    and public.storage_object_member(org_a || '/' || mem_alice || '/face.jpg') = public.jwt_member_id()
  ) then
    raise exception 'a member cannot read their own photo';
  end if;

  if public.storage_object_member(org_a || '/' || mem_carol || '/face.jpg') = public.jwt_member_id() then
    raise exception 'a member can read another member''s photo';
  end if;

  execute 'reset role';

  -- cleanup -----------------------------------------------------------------

  delete from public.orgs where id in (org_a, org_b);
  delete from auth.users where id in (user_alice, user_bob, user_nobody, user_impostor);

  raise notice 'member app: all assertions passed';
end $$;
