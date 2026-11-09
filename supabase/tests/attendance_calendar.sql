-- Gym schedule + attendance calendar: org_holidays, weekly_off in set_org_setting,
-- my_attendance_calendar, my_renewal_request, the realtime publication and grants.
-- Seeds two orgs, drives the real functions under member/staff claims, asserts,
-- then removes its fixtures. A failed assertion aborts (and rolls back).
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/attendance_calendar.sql

-- Status / label of one date as the calling member sees it. A temp function so the
-- block below stays readable; it dies with the session.
create or replace function pg_temp.cal_status(p_date date)
returns text
language sql
as $$
  select d ->> 'status'
  from jsonb_array_elements(
         public.my_attendance_calendar(
           extract(year from p_date)::integer, extract(month from p_date)::integer
         ) -> 'days'
       ) d
  where d ->> 'date' = p_date::text;
$$;

create or replace function pg_temp.cal_label(p_date date)
returns text
language sql
as $$
  select d ->> 'label'
  from jsonb_array_elements(
         public.my_attendance_calendar(
           extract(year from p_date)::integer, extract(month from p_date)::integer
         ) -> 'days'
       ) d
  where d ->> 'date' = p_date::text;
$$;

do $$
declare
  org_a uuid := 'c1c1c1c1-1111-1111-1111-111111111111';
  org_b uuid := 'c2c2c2c2-2222-2222-2222-222222222222';
  br_a uuid := 'c1b00000-0000-0000-0000-000000000001';
  br_b uuid := 'c2b00000-0000-0000-0000-000000000001';
  st_owner uuid := 'c1000000-0000-0000-0000-00000000000f';
  st_mgr   uuid := 'c1000000-0000-0000-0000-00000000000a';
  st_desk  uuid := 'c1000000-0000-0000-0000-00000000000d';
  st_tr    uuid := 'c1000000-0000-0000-0000-000000000011';
  st_b_owner uuid := 'c2000000-0000-0000-0000-00000000000f';

  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid; mb uuid;
  plan_a uuid; plan_pack uuid; plan_b uuid;
  t date;
  wd integer;
  r jsonb;
  s text;
  n integer;
  failed boolean;
  hol_a uuid; hol_b uuid;
  h public.org_holidays;
  claims_owner text; claims_mgr text; claims_desk text; claims_tr text; claims_b_owner text;
  claims_m1 text; claims_m2 text; claims_m3 text; claims_m4 text; claims_m5 text; claims_mb text;
begin
  -- fixtures ---------------------------------------------------------------------
  insert into public.orgs (id, name, slug) values
    (org_a, 'Calendar Fitness', 'calendar-test-a'),
    (org_b, 'Other Calendar Gym', 'calendar-test-b');
  insert into public.branches (id, org_id, name) values (br_a, org_a, 'Cal One'), (br_b, org_b, 'Cal Two');
  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_owner, org_a, 'Cal Owner', 'owner@calendar.test', 'owner', '{}', 'active'),
    (st_mgr,   org_a, 'Cal Manager', 'mgr@calendar.test', 'manager', array[br_a], 'active'),
    (st_desk,  org_a, 'Cal Desk', 'desk@calendar.test', 'front_desk', array[br_a], 'active'),
    (st_tr,    org_a, 'Cal Trainer', 'tr@calendar.test', 'trainer', array[br_a], 'active'),
    (st_b_owner, org_b, 'Other Owner', 'owner@othercal.test', 'owner', '{}', 'active');

  insert into public.members (org_id, home_branch_id, full_name, phone) values (org_a, br_a, 'Cal One', '9851000001') returning id into m1;
  insert into public.members (org_id, home_branch_id, full_name, phone) values (org_a, br_a, 'Cal Two', '9851000002') returning id into m2;
  insert into public.members (org_id, home_branch_id, full_name, phone) values (org_a, br_a, 'Cal Three', '9851000003') returning id into m3;
  insert into public.members (org_id, home_branch_id, full_name, phone) values (org_a, br_a, 'Cal Four', '9851000004') returning id into m4;
  insert into public.members (org_id, home_branch_id, full_name, phone) values (org_a, br_a, 'Cal Five', '9851000005') returning id into m5;
  insert into public.members (org_id, home_branch_id, full_name, phone) values (org_b, br_b, 'Cal Other', '9851000009') returning id into mb;

  insert into public.membership_plans (org_id, name, plan_type, duration_days, price_paisa, branch_ids)
  values (org_a, 'Cal Monthly', 'time', 30, 100000, array[br_a]) returning id into plan_a;
  insert into public.membership_plans (org_id, name, plan_type, session_count, price_paisa, branch_ids)
  values (org_a, 'Cal Pack', 'session_pack', 10, 100000, array[br_a]) returning id into plan_pack;
  insert into public.membership_plans (org_id, name, plan_type, duration_days, price_paisa, branch_ids)
  values (org_b, 'Other Monthly', 'time', 30, 100000, array[br_b]) returning id into plan_b;

  t := public.org_today(org_a);

  claims_owner := json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated', 'org_id', org_a::text,
    'staff_id', st_owner::text, 'staff_role', 'owner', 'branch_ids', json_build_array())::text;
  claims_mgr := json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated', 'org_id', org_a::text,
    'staff_id', st_mgr::text, 'staff_role', 'manager', 'branch_ids', json_build_array(br_a))::text;
  claims_desk := json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated', 'org_id', org_a::text,
    'staff_id', st_desk::text, 'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a))::text;
  claims_tr := json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated', 'org_id', org_a::text,
    'staff_id', st_tr::text, 'staff_role', 'trainer', 'branch_ids', json_build_array(br_a))::text;
  claims_b_owner := json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated', 'org_id', org_b::text,
    'staff_id', st_b_owner::text, 'staff_role', 'owner', 'branch_ids', json_build_array())::text;
  claims_m1 := json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated', 'org_id', org_a::text,
    'member_id', m1::text, 'branch_ids', json_build_array(br_a))::text;
  claims_m2 := replace(claims_m1, m1::text, m2::text);
  claims_m3 := replace(claims_m1, m1::text, m3::text);
  claims_m4 := replace(claims_m1, m1::text, m4::text);
  claims_m5 := replace(claims_m1, m1::text, m5::text);
  claims_mb := json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated', 'org_id', org_b::text,
    'member_id', mb::text, 'branch_ids', json_build_array(br_b))::text;

  -- memberships --------------------------------------------------------------------
  -- m1: expired window A (t-40..t-20) then active window B (t-14..t+16), gap between.
  insert into public.memberships (org_id, branch_id, member_id, plan_id, plan_name, plan_type, start_date, end_date, price_paisa, status) values
    (org_a, br_a, m1, plan_a, 'Cal Monthly', 'time', t - 40, t - 20, 100000, 'expired'),
    (org_a, br_a, m1, plan_a, 'Cal Monthly', 'time', t - 14, t + 16, 100000, 'active');
  -- m2: open-ended session pack from t-5.
  insert into public.memberships (org_id, branch_id, member_id, plan_id, plan_name, plan_type, start_date, end_date, sessions_total, sessions_remaining, price_paisa)
  values (org_a, br_a, m2, plan_pack, 'Cal Pack', 'session_pack', t - 5, null, 10, 10, 100000);
  -- m3: frozen since t-6.
  insert into public.memberships (org_id, branch_id, member_id, plan_id, plan_name, plan_type, start_date, end_date, price_paisa, status, frozen_on)
  values (org_a, br_a, m3, plan_a, 'Cal Monthly', 'time', t - 20, t + 10, 100000, 'frozen', t - 6);
  -- m4: cancelled.
  insert into public.memberships (org_id, branch_id, member_id, plan_id, plan_name, plan_type, start_date, end_date, price_paisa, status, cancelled_at)
  values (org_a, br_a, m4, plan_a, 'Cal Monthly', 'time', t - 20, t + 10, 100000, 'cancelled', now());
  -- m5: plain active, no visits at all.
  insert into public.memberships (org_id, branch_id, member_id, plan_id, plan_name, plan_type, start_date, end_date, price_paisa)
  values (org_a, br_a, m5, plan_a, 'Cal Monthly', 'time', t - 14, t + 16, 100000);
  insert into public.memberships (org_id, branch_id, member_id, plan_id, plan_name, plan_type, start_date, end_date, price_paisa)
  values (org_b, br_b, mb, plan_b, 'Other Monthly', 'time', t - 14, t + 16, 100000);

  -- visits (checked_in_at at noon local; attended_on is derived by the trigger)
  insert into public.attendance (org_id, branch_id, member_id, method, checked_in_at) values
    (org_a, br_a, m1, 'manual', ((t - 3)::text || ' 12:00+05:45')::timestamptz),   -- on a weekly-off weekday
    (org_a, br_a, m1, 'manual', ((t - 7)::text || ' 12:00+05:45')::timestamptz),   -- on a holiday
    (org_a, br_a, m1, 'manual', ((t - 25)::text || ' 12:00+05:45')::timestamptz),  -- in window A
    (org_a, br_a, m3, 'manual', ((t - 8)::text || ' 12:00+05:45')::timestamptz),
    (org_a, br_a, m3, 'manual', ((t - 3)::text || ' 12:00+05:45')::timestamptz),   -- while frozen
    (org_a, br_a, m4, 'manual', ((t - 2)::text || ' 12:00+05:45')::timestamptz);
  -- a second visit the same day (override) must not double count
  insert into public.attendance (org_id, branch_id, member_id, method, checked_in_at, is_override, override_reason)
  values (org_a, br_a, m1, 'manual', ((t - 3)::text || ' 18:00+05:45')::timestamptz, true, 'evening session');

  -- weekly_off = the weekday of t-10 (a day inside window B, and also of t-3, t-24, t-17)
  wd := extract(isodow from t - 10)::integer;

  -- 1. weekly_off validation (set_org_setting) ------------------------------------------
  perform set_config('request.jwt.claims', claims_owner, true);
  r := public.set_org_setting('weekly_off', to_jsonb(array[wd, wd]));
  assert r -> 'weekly_off' = to_jsonb(array[wd]), format('deduped weekly_off: %s', r);
  r := public.set_org_setting('weekly_off', '[7,1,7,3]'::jsonb);
  assert r -> 'weekly_off' = '[1,3,7]'::jsonb, format('sorted + deduped weekly_off: %s', r);
  r := public.set_org_setting('weekly_off', '[]'::jsonb);
  assert r -> 'weekly_off' = '[]'::jsonb, format('empty weekly_off: %s', r);
  foreach s in array array['[0]', '[8]', '["1"]', '[1.5]', '"6"', '{}', 'null', 'true', '[1,2,3,4,5,6,7,1]', '[-1]', '[[1]]'] loop
    failed := false;
    begin perform public.set_org_setting('weekly_off', s::jsonb); exception when sqlstate '22023' then failed := true; end;
    assert failed, format('weekly_off %s should be rejected', s);
  end loop;
  failed := false;
  begin perform public.set_org_setting('weekly_off', null); exception when sqlstate '22023' then failed := true; end;
  assert failed, 'a SQL null weekly_off should be rejected';
  -- existing keys still work
  r := public.set_org_setting('track_check_out', 'true'::jsonb);
  assert (r ->> 'track_check_out')::boolean, 'existing keys still accepted';
  -- manager: weekly_off yes, anything else no
  perform set_config('request.jwt.claims', claims_mgr, true);
  r := public.set_org_setting('weekly_off', '[6]'::jsonb);
  assert r -> 'weekly_off' = '[6]'::jsonb, 'manager sets weekly_off';
  failed := false;
  begin perform public.set_org_setting('track_check_out', 'false'::jsonb); exception when sqlstate '42501' then failed := true; end;
  assert failed, 'manager must not change other settings';
  -- desk / trainer / member: no
  foreach s in array array[claims_desk, claims_tr, claims_m1] loop
    perform set_config('request.jwt.claims', s, true);
    failed := false;
    begin perform public.set_org_setting('weekly_off', '[6]'::jsonb); exception when sqlstate '42501' then failed := true; end;
    assert failed, 'only owner/manager set weekly_off';
    -- regression: a null role (member principal) once slipped past the owner check
    failed := false;
    begin perform public.set_org_setting('track_check_out', 'false'::jsonb); exception when sqlstate '42501' then failed := true; end;
    assert failed, 'only the owner sets other settings (desk / trainer / member refused)';
  end loop;
  -- back to the real value for the calendar tests
  perform set_config('request.jwt.claims', claims_owner, true);
  perform public.set_org_setting('weekly_off', to_jsonb(array[wd]));

  -- 2. holiday RPCs --------------------------------------------------------------------
  h := public.add_org_holiday(t - 5, '  Test Fest ');
  hol_a := h.id;
  assert h.name = 'Test Fest' and h.on_date = t - 5 and h.org_id = org_a, 'owner adds a holiday (name trimmed)';
  perform public.add_org_holiday(t - 7, 'Visit Day');
  perform set_config('request.jwt.claims', claims_mgr, true);
  h := public.add_org_holiday(t + 3, 'Manager Day');
  assert h.created_by = st_mgr, 'manager adds a holiday';
  failed := false;
  begin perform public.add_org_holiday(t - 5, 'Dup'); exception when sqlstate '23505' then failed := true; end;
  assert failed, 'duplicate holiday date rejected';
  failed := false;
  begin perform public.add_org_holiday(t + 9, '   '); exception when sqlstate '22023' then failed := true; end;
  assert failed, 'blank name rejected';
  failed := false;
  begin perform public.add_org_holiday(t + 9, repeat('x', 81)); exception when sqlstate '22023' then failed := true; end;
  assert failed, 'over-long name rejected';
  failed := false;
  begin perform public.add_org_holiday(null, 'x'); exception when sqlstate '22023' then failed := true; end;
  assert failed, 'null date rejected';
  failed := false;
  begin perform public.add_org_holiday(date '1999-12-31', 'x'); exception when sqlstate '22023' then failed := true; end;
  assert failed, 'date out of range rejected';
  foreach s in array array[claims_desk, claims_tr, claims_m1] loop
    perform set_config('request.jwt.claims', s, true);
    failed := false;
    begin perform public.add_org_holiday(t + 20, 'Nope'); exception when sqlstate '42501' then failed := true; end;
    assert failed, 'only owner/manager add holidays';
    failed := false;
    begin perform public.remove_org_holiday(hol_a); exception when sqlstate '42501' then failed := true; end;
    assert failed, 'only owner/manager remove holidays';
  end loop;

  -- the other org has its own holiday on the same date
  perform set_config('request.jwt.claims', claims_b_owner, true);
  h := public.add_org_holiday(t - 5, 'Other Org Fest');
  hol_b := h.id;
  failed := false;
  begin perform public.remove_org_holiday(hol_a); exception when sqlstate 'P0002' then failed := true; end;
  assert failed, 'org B cannot remove org A''s holiday';
  perform set_config('request.jwt.claims', claims_owner, true);
  failed := false;
  begin perform public.remove_org_holiday(hol_b); exception when sqlstate 'P0002' then failed := true; end;
  assert failed, 'org A cannot remove org B''s holiday';
  failed := false;
  begin perform public.remove_org_holiday(gen_random_uuid()); exception when sqlstate 'P0002' then failed := true; end;
  assert failed, 'removing an unknown id fails';
  -- remove + re-add works (manager removes, ends clean)
  perform set_config('request.jwt.claims', claims_mgr, true);
  perform public.remove_org_holiday((select id from public.org_holidays where org_id = org_a and on_date = t + 3));
  assert not exists (select 1 from public.org_holidays where org_id = org_a and on_date = t + 3), 'manager removed it';

  -- RLS: staff read own org only, nobody writes directly ----------------------------------
  perform set_config('request.jwt.claims', claims_desk, true);
  execute 'set local role authenticated';
  select count(*) into n from public.org_holidays;
  assert n = 2, format('front desk reads its own org''s holidays only, saw %s', n);
  failed := false;
  begin insert into public.org_holidays (org_id, on_date, name) values (org_a, t + 40, 'direct'); exception when insufficient_privilege then failed := true; end;
  assert failed, 'direct insert into org_holidays denied';
  failed := false;
  begin delete from public.org_holidays where id = hol_a; exception when insufficient_privilege then failed := true; end;
  assert failed, 'direct delete from org_holidays denied';
  perform set_config('request.jwt.claims', claims_m1, true);
  select count(*) into n from public.org_holidays;
  assert n = 0, format('a member reads no holidays directly, saw %s', n);
  execute 'reset role';

  -- audit trail
  select count(*) into n from public.audit_log where org_id = org_a and entity = 'org_holidays';
  assert n >= 4, format('holiday add/remove should be audited, found %s', n);

  -- 3. calendar --------------------------------------------------------------------------
  perform set_config('request.jwt.claims', claims_m1, true);
  r := public.my_attendance_calendar(extract(year from t)::integer, extract(month from t)::integer);
  assert (r ->> 'today')::date = t, format('today in response: %s', r ->> 'today');
  assert jsonb_array_length(r -> 'days') = extract(day from (date_trunc('month', t) + interval '1 month' - interval '1 day'))::integer,
    'one entry per day of the month';
  assert (r -> 'days' -> 0 ->> 'date')::date = date_trunc('month', t)::date, 'days start on the 1st';

  assert pg_temp.cal_status(t) = 'none', 'today without a visit is none, not absent';
  assert pg_temp.cal_status(t + 1) = 'none', 'future is none';
  assert pg_temp.cal_status(t + 16) = 'none', 'future inside the window is none';
  assert pg_temp.cal_status(t - 3) = 'present', 'visit on a weekly-off weekday is present';
  assert pg_temp.cal_status(t - 7) = 'present' and pg_temp.cal_label(t - 7) = 'Visit Day', 'visit on a holiday is present, label kept';
  assert pg_temp.cal_status(t - 5) = 'holiday' and pg_temp.cal_label(t - 5) = 'Test Fest', 'holiday inside the window (org A name, not org B''s)';
  assert pg_temp.cal_status(t - 10) = 'off', 'weekly off inside the window';
  assert pg_temp.cal_status(t - 24) = 'off', 'weekly off inside the older window';
  assert pg_temp.cal_status(t - 4) = 'absent', 'weekday in window with no visit is absent';
  assert pg_temp.cal_status(t - 14) = 'absent', 'window start is inclusive';
  assert pg_temp.cal_status(t - 13) = 'absent', 'absent mid-window';
  assert pg_temp.cal_status(t - 1) = 'absent', 'yesterday in window with no visit is absent';
  assert pg_temp.cal_status(t - 20) = 'absent', 'older window end is inclusive';
  assert pg_temp.cal_status(t - 25) = 'present', 'visit in the older window';
  assert pg_temp.cal_status(t - 40) = 'absent', 'older window start is inclusive';
  assert pg_temp.cal_status(t - 41) = 'none', 'before any membership is none';
  assert pg_temp.cal_status(t - 15) = 'none', 'gap between memberships is none';
  assert pg_temp.cal_status(t - 17) = 'none', 'weekly-off weekday in the gap is none, not off';
  assert pg_temp.cal_label(t - 4) is null, 'no label on ordinary days';

  -- a holiday outside any window is none (label still shown)
  perform set_config('request.jwt.claims', claims_owner, true);
  perform public.add_org_holiday(t - 17, 'Gap Day');
  perform set_config('request.jwt.claims', claims_m1, true);
  assert pg_temp.cal_status(t - 17) = 'none' and pg_temp.cal_label(t - 17) = 'Gap Day', 'holiday outside a window stays none';

  -- summary matches the day list; two visits on t-3 count once
  r := public.my_attendance_calendar(extract(year from (t - 3))::integer, extract(month from (t - 3))::integer);
  assert (r -> 'summary' ->> 'present')::integer = (select count(*) from jsonb_array_elements(r -> 'days') d where d ->> 'status' = 'present'), 'present summary';
  assert (r -> 'summary' ->> 'absent')::integer = (select count(*) from jsonb_array_elements(r -> 'days') d where d ->> 'status' = 'absent'), 'absent summary';
  assert (select count(*) from jsonb_array_elements(r -> 'days') d where d ->> 'date' = (t - 3)::text) = 1, 'one entry per date (override visit is not a second day)';

  -- today with a visit becomes present
  insert into public.attendance (org_id, branch_id, member_id, method) values (org_a, br_a, m1, 'manual');
  assert pg_temp.cal_status(t) = 'present', 'today with a visit is present';

  -- month lengths + validation
  assert jsonb_array_length(public.my_attendance_calendar(2001, 2) -> 'days') = 28, 'February 2001 has 28 days';
  assert jsonb_array_length(public.my_attendance_calendar(2004, 2) -> 'days') = 29, 'February 2004 has 29 days';
  assert jsonb_array_length(public.my_attendance_calendar(2001, 1) -> 'days') = 31, 'January has 31 days';
  assert jsonb_array_length(public.my_attendance_calendar(2001, 4) -> 'days') = 30, 'April has 30 days';
  assert not exists (select 1 from jsonb_array_elements(public.my_attendance_calendar(2001, 2) -> 'days') d where d ->> 'status' <> 'none'),
    'a month with no memberships is all none';
  assert public.my_attendance_calendar(2100, 12) -> 'summary' = '{"present":0,"absent":0}'::jsonb, 'far future is empty';
  failed := false; begin perform public.my_attendance_calendar(2026, 0); exception when sqlstate '22023' then failed := true; end;
  assert failed, 'month 0';
  failed := false; begin perform public.my_attendance_calendar(2026, 13); exception when sqlstate '22023' then failed := true; end;
  assert failed, 'month 13';
  failed := false; begin perform public.my_attendance_calendar(1999, 5); exception when sqlstate '22023' then failed := true; end;
  assert failed, 'year 1999';
  failed := false; begin perform public.my_attendance_calendar(2101, 5); exception when sqlstate '22023' then failed := true; end;
  assert failed, 'year 2101';
  failed := false; begin perform public.my_attendance_calendar(null, 5); exception when sqlstate '22023' then failed := true; end;
  assert failed, 'null year';

  -- open-ended membership (m2): open until today
  perform set_config('request.jwt.claims', claims_m2, true);
  assert pg_temp.cal_status(t - 6) = 'none', 'before an open-ended start is none';
  assert pg_temp.cal_status(t - 5) = 'holiday', 'open-ended start day is inside the window (holiday here)';
  assert pg_temp.cal_status(t - 4) = 'absent', 'open-ended: day after start, no visit, is absent';
  assert pg_temp.cal_status(t - 1) = 'absent', 'open-ended: yesterday absent';
  assert pg_temp.cal_status(t) = 'none', 'open-ended: today is none';
  assert pg_temp.cal_status(t + 5) = 'none', 'open-ended: future is none';
  assert pg_temp.cal_status(t - 10) = 'none', 'm2 sees none where only m1 has a window';
  assert pg_temp.cal_label(t - 5) = 'Test Fest' and pg_temp.cal_status(t - 5) = 'holiday', 'open-ended member sees the org holiday inside the window';

  -- frozen member (m3): frozen_on..today is none, other days normal, present still wins
  perform set_config('request.jwt.claims', claims_m3, true);
  assert pg_temp.cal_status(t - 9) = 'absent', 'before the freeze, no visit: absent';
  assert pg_temp.cal_status(t - 10) = 'off', 'before the freeze, weekly off: off';
  assert pg_temp.cal_status(t - 8) = 'present', 'before the freeze, visit: present';
  assert pg_temp.cal_status(t - 7) = 'holiday', 'before the freeze, holiday inside window';
  assert pg_temp.cal_status(t - 6) = 'none', 'freeze start day is none';
  assert pg_temp.cal_status(t - 5) = 'none', 'frozen holiday/off span is none';
  assert pg_temp.cal_status(t - 4) = 'none', 'frozen span is none';
  assert pg_temp.cal_status(t - 3) = 'present', 'a visit during the freeze is still present';
  assert pg_temp.cal_status(t - 1) = 'none', 'frozen up to today';

  -- cancelled membership (m4): never counts as a window
  perform set_config('request.jwt.claims', claims_m4, true);
  assert pg_temp.cal_status(t - 10) = 'none', 'cancelled membership gives no absent days';
  assert pg_temp.cal_status(t - 2) = 'present', 'a visit still shows present without a window';

  -- isolation: m5 has the same window as m1 but none of its visits
  perform set_config('request.jwt.claims', claims_m5, true);
  assert pg_temp.cal_status(t - 4) = 'absent', 'm5 plain absent day';
  assert pg_temp.cal_status(t - 3) = 'off', 'm5 does not see m1''s visit on the weekly-off day (off, not present)';
  assert pg_temp.cal_status(t - 7) = 'holiday', 'm5 holiday without a visit';
  r := public.my_attendance_calendar(extract(year from t)::integer, extract(month from t)::integer);
  assert (r -> 'summary' ->> 'present')::integer = 0, 'm5 has no present days';
  -- other org: own holiday name, own membership, nothing of org A
  perform set_config('request.jwt.claims', claims_mb, true);
  assert pg_temp.cal_label(t - 5) = 'Other Org Fest', 'org B member sees org B''s holiday';
  assert pg_temp.cal_status(t - 3) = 'absent', 'org B member sees nothing of org A''s visits';
  assert pg_temp.cal_status(t - 10) = 'absent', 'org B has no weekly_off, so t-10 is a plain absent day';

  -- staff and signed-out callers are refused
  foreach s in array array[claims_owner, claims_desk, claims_tr] loop
    perform set_config('request.jwt.claims', s, true);
    failed := false;
    begin perform public.my_attendance_calendar(2026, 1); exception when sqlstate '42501' then failed := true; end;
    assert failed, 'staff must not call my_attendance_calendar';
    failed := false;
    begin perform public.my_renewal_request(); exception when sqlstate '42501' then failed := true; end;
    assert failed, 'staff must not call my_renewal_request';
  end loop;
  perform set_config('request.jwt.claims', null, true);
  failed := false;
  begin perform public.my_attendance_calendar(2026, 1); exception when sqlstate '42501' then failed := true; end;
  assert failed, 'no claims at all is refused';

  -- weekly_off cleared: off days become absent again
  perform set_config('request.jwt.claims', claims_owner, true);
  perform public.set_org_setting('weekly_off', '[]'::jsonb);
  perform set_config('request.jwt.claims', claims_m1, true);
  assert pg_temp.cal_status(t - 10) = 'absent', 'no weekly_off: that weekday is a normal absent day';
  -- removed holiday: day goes back to absent
  perform set_config('request.jwt.claims', claims_owner, true);
  perform public.remove_org_holiday(hol_a);
  perform set_config('request.jwt.claims', claims_m1, true);
  assert pg_temp.cal_status(t - 5) = 'absent' and pg_temp.cal_label(t - 5) is null, 'removed holiday is an absent day again';

  -- 4. my_renewal_request ----------------------------------------------------------------
  perform set_config('request.jwt.claims', claims_m1, true);
  assert public.my_renewal_request() is null, 'no request yet -> null';
  insert into public.renewal_requests (org_id, member_id, phone) values (org_a, m1, '9851000001');
  r := public.my_renewal_request();
  assert r ->> 'status' = 'pending' and (r ->> 'request_count')::integer = 1
     and r ? 'requested_at' and r ? 'last_requested_at', format('pending request shape: %s', r);
  perform set_config('request.jwt.claims', claims_m2, true);
  assert public.my_renewal_request() is null, 'another member sees none of it';
  perform set_config('request.jwt.claims', claims_mb, true);
  assert public.my_renewal_request() is null, 'another org''s member sees none of it';
  update public.renewal_requests set status = 'done', handled_at = now() where member_id = m1;
  perform set_config('request.jwt.claims', claims_m1, true);
  assert public.my_renewal_request() is null, 'a handled request is no longer pending';

  -- realtime publication
  assert exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'renewal_requests'
  ), 'renewal_requests is in the supabase_realtime publication';

  -- 5. grants -----------------------------------------------------------------------------
  perform set_config('request.jwt.claims', null, true);
  assert not has_function_privilege('anon', 'public.my_attendance_calendar(integer,integer)', 'execute'), 'anon calendar';
  assert not has_function_privilege('anon', 'public.my_renewal_request()', 'execute'), 'anon renewal';
  assert not has_function_privilege('anon', 'public.add_org_holiday(date,text)', 'execute'), 'anon add holiday';
  assert not has_function_privilege('anon', 'public.remove_org_holiday(uuid)', 'execute'), 'anon remove holiday';
  assert not has_function_privilege('anon', 'public.set_org_setting(text,jsonb)', 'execute'), 'anon set_org_setting';
  assert has_function_privilege('authenticated', 'public.my_attendance_calendar(integer,integer)', 'execute'), 'authenticated calendar';
  assert has_function_privilege('authenticated', 'public.my_renewal_request()', 'execute'), 'authenticated renewal';
  assert has_function_privilege('authenticated', 'public.add_org_holiday(date,text)', 'execute'), 'authenticated add holiday';
  assert has_function_privilege('authenticated', 'public.remove_org_holiday(uuid)', 'execute'), 'authenticated remove holiday';
  assert has_function_privilege('authenticated', 'public.set_org_setting(text,jsonb)', 'execute'), 'authenticated set_org_setting';
  assert not has_table_privilege('anon', 'public.org_holidays', 'select'), 'anon reads holidays';
  assert not has_table_privilege('authenticated', 'public.org_holidays', 'insert'), 'authenticated inserts holidays';
  assert (select relrowsecurity from pg_class where oid = 'public.org_holidays'::regclass), 'org_holidays RLS enabled';

  -- teardown ------------------------------------------------------------------------------
  delete from public.orgs where id in (org_a, org_b);
  assert not exists (select 1 from public.org_holidays where org_id in (org_a, org_b)), 'fixtures removed';

  raise notice 'attendance calendar: all assertions passed';
end $$;
