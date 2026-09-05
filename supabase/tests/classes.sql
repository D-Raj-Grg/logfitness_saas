-- Phase 4 gate: classes, sessions, bookings, and the two booking RPCs,
-- exercised end to end as real personas -- plus the cross-tenant and
-- member-scope negative tests every new table owes.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/classes.sql

do $$
declare
  org_a uuid := '55555555-5555-5555-5555-555555555555';
  org_b uuid := '66666666-6666-6666-6666-666666666666';
  br_a1 uuid := 'eeeeeee1-0000-0000-0000-000000000001'; -- member_a1/a3's home branch
  br_a2 uuid := 'eeeeeee1-0000-0000-0000-000000000002'; -- a different branch, same org
  br_b1 uuid := 'fffffff1-0000-0000-0000-000000000001';

  st_a_owner uuid := 'e0000000-0000-0000-0000-00000000000f';
  st_a_desk  uuid := 'e0000000-0000-0000-0000-00000000000d';
  st_b_owner uuid := 'f0000000-0000-0000-0000-00000000000f';

  plan_a uuid;
  plan_b uuid;

  member_a1 uuid; -- home br_a1; books, then gets promoted off the waitlist
  member_a2 uuid; -- home br_a1; waitlisted behind member_a1
  member_a3 uuid; -- home br_a1; drives the window and wrong-branch cases
  member_b1 uuid; -- org B

  class_a1 uuid;  -- org A, br_a1, capacity 1
  class_a2 uuid;  -- org A, br_a2, capacity 5 (wrong-branch case)
  class_b1 uuid;  -- org B

  sess_cap1 uuid;   -- capacity 1, starts in 2 days -- overflow + promotion
  sess_soon uuid;   -- capacity 5, starts in 30 minutes -- cancellation window
  sess_wrong_branch uuid; -- at br_a2
  sess_b uuid;      -- org B -- cross-tenant

  today_a date;
  today_b date;
  res jsonb;
  n integer;
  failed boolean;
begin
  -- fixtures, as the owning role so RLS is out of the way --------------------
  insert into public.orgs (id, name, slug) values
    (org_a, 'Epsilon Fitness', 'epsilon-fitness-test'),
    (org_b, 'Zeta Gyms', 'zeta-gyms-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Epsilon Thamel'),
    (br_a2, org_a, 'Epsilon Patan'),
    (br_b1, org_b, 'Zeta Baneshwor');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_a_owner, org_a, 'Epsilon Owner', 'owner@epsilon.test', 'owner',      '{}',         'active'),
    (st_a_desk,  org_a, 'Epsilon Desk',  'desk@epsilon.test',  'front_desk', array[br_a1], 'active'),
    (st_b_owner, org_b, 'Zeta Owner',    'owner@zeta.test',    'owner',      '{}',         'active');

  today_a := public.org_today(org_a);
  today_b := public.org_today(org_b);

  insert into public.membership_plans (org_id, name, plan_type, duration_days, price_paisa)
  values (org_a, 'Monthly', 'time', 30, 250000) returning id into plan_a;

  insert into public.membership_plans (org_id, name, plan_type, duration_days, price_paisa)
  values (org_b, 'Monthly', 'time', 30, 250000) returning id into plan_b;

  insert into public.members (org_id, home_branch_id, full_name, phone) values
    (org_a, br_a1, 'Booker One', '9810000001') returning id into member_a1;
  insert into public.members (org_id, home_branch_id, full_name, phone) values
    (org_a, br_a1, 'Booker Two', '9810000002') returning id into member_a2;
  insert into public.members (org_id, home_branch_id, full_name, phone) values
    (org_a, br_a1, 'Booker Three', '9810000003') returning id into member_a3;
  insert into public.members (org_id, home_branch_id, full_name, phone) values
    (org_b, br_b1, 'Zeta Member', '9820000001') returning id into member_b1;

  -- Every booker needs a live membership -- book_class_session refuses
  -- anyone without one.
  insert into public.memberships
    (org_id, branch_id, member_id, plan_id, plan_name, plan_type, start_date, end_date, price_paisa, status)
  values
    (org_a, br_a1, member_a1, plan_a, 'Monthly', 'time', today_a, today_a + 30, 250000, 'active'),
    (org_a, br_a1, member_a2, plan_a, 'Monthly', 'time', today_a, today_a + 30, 250000, 'active'),
    (org_a, br_a1, member_a3, plan_a, 'Monthly', 'time', today_a, today_a + 30, 250000, 'active'),
    (org_b, br_b1, member_b1, plan_b, 'Monthly', 'time', today_b, today_b + 30, 250000, 'active');

  insert into public.classes (org_id, branch_id, name, capacity)
  values (org_a, br_a1, 'Spin', 5) returning id into class_a1;
  insert into public.classes (org_id, branch_id, name, capacity)
  values (org_a, br_a2, 'Yoga', 5) returning id into class_a2;
  insert into public.classes (org_id, branch_id, name, capacity)
  values (org_b, br_b1, 'Zumba', 5) returning id into class_b1;

  insert into public.class_sessions (org_id, branch_id, class_id, starts_at, ends_at, capacity)
  values (org_a, br_a1, class_a1, now() + interval '2 days', now() + interval '2 days 1 hour', 1)
  returning id into sess_cap1;

  insert into public.class_sessions (org_id, branch_id, class_id, starts_at, ends_at, capacity)
  values (org_a, br_a1, class_a1, now() + interval '30 minutes', now() + interval '90 minutes', 5)
  returning id into sess_soon;

  insert into public.class_sessions (org_id, branch_id, class_id, starts_at, ends_at, capacity)
  values (org_a, br_a2, class_a2, now() + interval '2 days', now() + interval '2 days 1 hour', 5)
  returning id into sess_wrong_branch;

  insert into public.class_sessions (org_id, branch_id, class_id, starts_at, ends_at, capacity)
  values (org_b, br_b1, class_b1, now() + interval '2 days', now() + interval '2 days 1 hour', 5)
  returning id into sess_b;

  -- persona: member A1 -- books the only seat -------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', member_a1::text,
    'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  res := public.book_class_session(sess_cap1);
  assert res ->> 'status' = 'booked',
    format('member_a1 should have booked the only seat, got %s', res);

  -- Wrong branch: sess_wrong_branch is at br_a2, member_a1's home is br_a1.
  failed := false;
  begin
    perform public.book_class_session(sess_wrong_branch);
  exception when check_violation then failed := true;
  end;
  assert failed, 'a booking at a branch that is not the member''s home branch was accepted';

  -- Double booking: member_a1 already holds a live booking on sess_cap1.
  failed := false;
  begin
    perform public.book_class_session(sess_cap1);
  exception when unique_violation then failed := true;
  end;
  assert failed, 'a member was allowed a second live booking on the same session';

  -- Cross-tenant: sess_b belongs to org B. member_a1 is org A.
  failed := false;
  begin
    perform public.book_class_session(sess_b);
  exception when no_data_found then failed := true;
  end;
  assert failed, 'an org A member was allowed to book an org B session';

  execute 'reset role';

  -- persona: member A2 -- capacity is spent, so this books the waitlist -----
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', member_a2::text,
    'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  res := public.book_class_session(sess_cap1);
  assert res ->> 'status' = 'waitlisted',
    format('member_a2 should have been waitlisted once capacity was spent, got %s', res);

  -- Member-scope negative: member_a2 must not see member_a1's booking.
  select count(*) into n from public.class_bookings where member_id = member_a1;
  assert n = 0,
    format('member_a2 could read member_a1''s bookings (%s rows visible)', n);

  execute 'reset role';

  select booked_count into n from public.class_sessions where id = sess_cap1;
  assert n = 1, format('sess_cap1 booked_count should be 1 (waitlist does not count), was %s', n);

  -- persona: member A1 again -- cancels, freeing the seat for the waitlist --
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', member_a1::text,
    'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  res := public.cancel_class_booking(
    (select id from public.class_bookings where session_id = sess_cap1 and member_id = member_a1)
  );
  assert res ->> 'status' = 'cancelled', 'member_a1''s booking did not cancel';
  assert (res ->> 'promoted_booking_id') is not null,
    'cancelling a booked seat did not promote the waitlist';

  execute 'reset role';

  select (status = 'booked'::public.class_booking_status) into failed
  from public.class_bookings
  where session_id = sess_cap1 and member_id = member_a2;
  assert failed, 'member_a2 was not promoted from the waitlist after member_a1 cancelled';

  -- persona: member A3 -- books the imminent session, then hits the window --
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', member_a3::text,
    'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  res := public.book_class_session(sess_soon);
  assert res ->> 'status' = 'booked', 'member_a3 could not book the imminent session';

  failed := false;
  begin
    perform public.cancel_class_booking(
      (select id from public.class_bookings where session_id = sess_soon and member_id = member_a3)
    );
  exception when check_violation then failed := true;
  end;
  assert failed,
    'a member was allowed to cancel inside the default 120-minute cancellation window';

  execute 'reset role';

  -- persona: front desk -- staff cancel any booking, any time --------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  res := public.cancel_class_booking(
    (select id from public.class_bookings where session_id = sess_soon and member_id = member_a3),
    'member called the desk'
  );
  assert res ->> 'status' = 'cancelled', 'staff could not cancel inside the member window';
  assert (res ->> 'cancelled_by_staff')::boolean, 'cancellation was not flagged as staff-initiated';

  -- Staff read is org-wide: the owner should see every booking in org A.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.class_bookings;
  assert n = 3,
    format('org A owner should see all 3 class bookings, saw %s', n);

  execute 'reset role';


  -- Review regressions ---------------------------------------------------------
  --
  -- Three defects the first cut of these RPCs had, each now a case here.

  -- 1. A front desk serves its own branches, not the whole chain. Booking on
  --    behalf of a member at a branch it does not serve must be refused.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  -- no_data_found is the branch-access refusal specifically: the home-branch
  -- mismatch further down raises check_violation, so catching the narrow code
  -- proves which check actually fired.
  failed := false;
  begin
    perform public.book_class_session(sess_wrong_branch, member_a3);
  exception when no_data_found then
    failed := true;
  end;
  assert failed,
    'a front desk booked a class at a branch outside its branch_ids';

  execute 'reset role';

  -- 2. A malformed or negative cancellation window falls back to the documented
  --    default rather than raising out of every cancellation for that org.
  update public.orgs set settings = '{"class_cancellation_window_minutes": "not-a-number"}'::jsonb
  where id = org_a;
  assert public.class_cancellation_window_minutes(org_a) = 120,
    'a malformed cancellation window did not fall back to 120';

  update public.orgs set settings = '{"class_cancellation_window_minutes": "-30"}'::jsonb
  where id = org_a;
  assert public.class_cancellation_window_minutes(org_a) = 120,
    'a negative cancellation window was accepted';

  update public.orgs set settings = '{}'::jsonb where id = org_a;

  raise notice 'classes.sql: all assertions passed';

  -- teardown ------------------------------------------------------------------
  delete from public.orgs where id in (org_a, org_b);
end $$;
