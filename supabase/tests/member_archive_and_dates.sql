-- Gate for the three record-level rules added on 2026-09-07: archiving instead
-- of deleting, the owner-only delete behind it, an unpaid or part-paid
-- registration, a plan that starts later, and adjusting the end date of a
-- membership already sold.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/member_archive_and_dates.sql

do $$
declare
  org_a uuid := 'c1c1c1c1-1111-1111-1111-111111111111';
  br_a1 uuid := 'c1b10000-0000-0000-0000-000000000001';
  br_a2 uuid := 'c1b10000-0000-0000-0000-000000000002';
  st_owner uuid := 'c1c00000-0000-0000-0000-00000000000f';
  st_mgr2  uuid := 'c1c00000-0000-0000-0000-00000000000b';
  st_desk  uuid := 'c1c00000-0000-0000-0000-00000000000d';

  plan_month uuid;
  res jsonb;
  member_1 uuid;
  member_2 uuid;
  membership_1 uuid;
  today_a date;
  n integer;
  txt text;
  archiver uuid;
  failed boolean;
begin
  insert into public.orgs (id, name, slug) values
    (org_a, 'Chi Fitness', 'chi-fitness-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Chi One'),
    (br_a2, org_a, 'Chi Two');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_owner, org_a, 'Chi Owner',   'owner@chi.test', 'owner',      '{}',         'active'),
    (st_mgr2,  org_a, 'Chi Manager', 'mgr@chi.test',   'manager',    array[br_a2], 'active'),
    (st_desk,  org_a, 'Chi Desk',    'desk@chi.test',  'front_desk', array[br_a1], 'active');

  today_a := public.org_today(org_a);

  -- persona: owner, seeding the catalogue --------------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  insert into public.membership_plans
    (org_id, name, plan_type, duration_days, price_paisa, signup_fee_paisa, branch_ids)
  values (org_a, 'Monthly', 'time', 30, 250000, 50000, array[br_a1])
  returning id into plan_month;

  -- persona: front desk at branch one ------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  -- UNPAID REGISTRATION --------------------------------------------------------
  -- The QR fails, the member still joins. The invoice is raised in full and the
  -- whole amount stands as a due.
  res := public.register_member(
    'Unpaid Member', '9860000001', br_a1,
    p_plan_id => plan_month, p_amount_paid_paisa => 0
  );
  member_1 := (res ->> 'member_id')::uuid;
  membership_1 := (res ->> 'membership_id')::uuid;

  assert (res ->> 'due_paisa')::bigint = 300000,
    format('an unpaid registration left %s due', res ->> 'due_paisa');

  select count(*) into n from public.payments p where p.member_id = member_1;
  assert n = 0, format('an unpaid registration recorded %s payments', n);

  select i.status::text into txt from public.invoices i where i.member_id = member_1;
  assert txt = 'unpaid', format('the invoice was %L, not unpaid', txt);

  -- The membership is live regardless: they train, they owe.
  select m.status::text into txt from public.members m where m.id = member_1;
  assert txt = 'active', format('an unpaid member came out %L', txt);

  -- FUTURE START ---------------------------------------------------------------
  res := public.register_member(
    'Later Member', '9860000002', br_a1,
    p_plan_id => plan_month, p_amount_paid_paisa => 300000,
    p_start_date => today_a + 7
  );
  member_2 := (res ->> 'member_id')::uuid;

  assert (res ->> 'start_date')::date = today_a + 7,
    format('the sale started %L', res ->> 'start_date');
  assert (res ->> 'end_date')::date = today_a + 36,
    format('a 30-day plan from next week ended %L', res ->> 'end_date');

  select ms.status::text into txt
  from public.memberships ms where ms.member_id = member_2;
  assert txt = 'upcoming', format('a future membership was %L', txt);

  select m.status::text into txt from public.members m where m.id = member_2;
  assert txt = 'expired',
    format('a member whose plan starts next week reads %L today', txt);

  -- A start date with no plan is a mistake worth naming.
  failed := false;
  begin
    perform public.register_member(
      'No Plan', '9860000003', br_a1, p_start_date => today_a + 1
    );
  exception when others then failed := true;
  end;
  assert failed, 'a start date was accepted with no plan to start';

  -- ADJUSTING DATES ------------------------------------------------------------
  -- Free days are money: the desk sells and freezes, but does not extend.
  failed := false;
  begin
    perform public.adjust_membership_dates(
      membership_1, today_a, today_a + 60, 'Nice guy'
    );
  exception when others then failed := true;
  end;
  assert failed, 'the front desk extended a membership';

  -- ARCHIVING ------------------------------------------------------------------
  perform public.archive_member(member_2, '  Registered twice  ');

  select m.archived_at is not null, m.archived_reason, m.archived_by
  into failed, txt, archiver
  from public.members m where m.id = member_2;
  assert failed, 'archive_member left archived_at null';
  assert txt = 'Registered twice', format('the reason was stored as %L', txt);
  assert archiver = st_desk, 'the archiver was not recorded';

  -- Archiving is not a status change: the membership and the derived status
  -- stay exactly where they were.
  select m.status::text into txt from public.members m where m.id = member_2;
  assert txt = 'expired', format('archiving moved the status to %L', txt);

  failed := false;
  begin
    perform public.archive_member(member_2, 'again');
  exception when others then failed := true;
  end;
  assert failed, 'a member was archived twice';

  perform public.restore_member(member_2);
  select count(*) into n
  from public.members m where m.id = member_2 and m.archived_at is null;
  assert n = 1, 'restore_member did not clear the archive';

  -- The desk may not delete, and RLS refuses the row rather than raising.
  delete from public.members where id = member_2;
  select count(*) into n from public.members m where m.id = member_2;
  assert n = 1, 'the front desk deleted a member';

  -- persona: manager of branch two ---------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_mgr2::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(br_a2::text)
  )::text, true);
  execute 'set local role authenticated';

  -- A manager runs their own floor, not someone else's.
  failed := false;
  begin
    perform public.adjust_membership_dates(
      membership_1, today_a, today_a + 60, 'Not my branch'
    );
  exception when others then failed := true;
  end;
  assert failed, 'a manager extended a membership at another branch';

  -- persona: owner --------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  res := public.adjust_membership_dates(
    membership_1, today_a, today_a + 40, 'Complimentary week'
  );
  assert (res ->> 'end_date')::date = today_a + 40,
    format('the end date came back as %L', res ->> 'end_date');
  assert (res ->> 'days_changed')::integer = 11,
    format('a move from day 29 to day 40 reported %s days', res ->> 'days_changed');

  select ms.notes into txt from public.memberships ms where ms.id = membership_1;
  assert txt like '%Complimentary week%', format('the reason was not kept: %L', txt);

  -- A reason is not optional, and the window cannot close before it opens.
  failed := false;
  begin
    perform public.adjust_membership_dates(membership_1, today_a, today_a + 45, '  ');
  exception when others then failed := true;
  end;
  assert failed, 'a date change was accepted with no reason';

  failed := false;
  begin
    perform public.adjust_membership_dates(membership_1, today_a, today_a - 5, 'Backwards');
  exception when others then failed := true;
  end;
  assert failed, 'the end date was moved before the start date';

  -- An expired membership comes back to life when its new end date is ahead:
  -- that is what extending one is for.
  -- The nightly sweep's work, faked: a membership whose last day is today and
  -- which has already been marked expired. The end date cannot go behind the
  -- start date, so this is as lapsed as a same-day membership gets.
  update public.memberships set status = 'expired', end_date = today_a
   where id = membership_1;

  res := public.adjust_membership_dates(membership_1, today_a, today_a + 10, 'Reinstated');
  assert res ->> 'status' = 'active',
    format('an extended membership stayed %L', res ->> 'status');

  select m.status::text into txt from public.members m where m.id = member_1;
  assert txt = 'active', format('the member did not follow the membership: %L', txt);

  -- MOVING THE START ------------------------------------------------------------
  -- "Start me in two days" said after the money changed hands. The end date
  -- follows, so the member keeps the term they paid for.
  res := public.adjust_membership_dates(
    membership_1, today_a + 2, today_a + 12, 'Member asked to start Tuesday'
  );
  assert (res ->> 'start_date')::date = today_a + 2,
    format('the start date came back as %L', res ->> 'start_date');
  assert (res ->> 'days_moved')::integer = 2,
    format('the move was reported as %s days', res ->> 'days_moved');
  assert res ->> 'status' = 'upcoming',
    format('a membership starting in two days is %L', res ->> 'status');

  select m.status::text into txt from public.members m where m.id = member_1;
  assert txt = 'expired',
    format('a member whose plan starts on Tuesday reads %L today', txt);

  -- A direct update is still refused: the trigger only opens for the RPC.
  failed := false;
  begin
    update public.memberships set start_date = today_a + 5 where id = membership_1;
  exception when others then failed := true;
  end;
  assert failed, 'the start date moved without going through the RPC';

  -- Once they have trained on it, the start date is a fact about attendance.
  insert into public.attendance (org_id, branch_id, member_id, membership_id, attended_on)
  values (org_a, br_a1, member_1, membership_1, today_a);

  failed := false;
  begin
    perform public.adjust_membership_dates(
      membership_1, today_a + 4, today_a + 14, 'Too late now'
    );
  exception when others then failed := true;
  end;
  assert failed, 'the start date moved after a check-in';

  -- The end date still moves; only the start is pinned.
  res := public.adjust_membership_dates(
    membership_1, today_a + 2, today_a + 20, 'Complimentary week'
  );
  assert (res ->> 'end_date')::date = today_a + 20,
    format('the end date came back as %L', res ->> 'end_date');

  -- The owner's delete is the one that lands, and it takes the history with it.
  delete from public.members where id = member_2;
  select count(*) into n from public.members m where m.id = member_2;
  assert n = 0, 'the owner could not delete a member';

  select count(*) into n from public.memberships ms where ms.member_id = member_2;
  assert n = 0, format('%s memberships outlived the member', n);

  -- teardown --------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id = org_a;

  raise notice 'member archive and dates: all assertions passed';
end $$;
