-- Gate for visitor messaging (2026-09-12): the welcome that rides the insert,
-- the follow-up sweep, and the manual send from the visitor log.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/visitor_messages.sql

do $$
declare
  org_a uuid := 'e1e1e1e1-1111-1111-1111-111111111111';
  org_b uuid := 'e2e2e2e2-2222-2222-2222-222222222222';
  br_a1 uuid := 'e1b10000-0000-0000-0000-000000000001';
  br_a2 uuid := 'e1b10000-0000-0000-0000-000000000002';
  br_b1 uuid := 'e2b10000-0000-0000-0000-000000000001';

  st_a_owner   uuid := 'e1c00000-0000-0000-0000-00000000000f';
  st_a_desk    uuid := 'e1c00000-0000-0000-0000-0000000000cd';
  st_a_trainer uuid := 'e1c00000-0000-0000-0000-0000000000ab';
  st_b_owner   uuid := 'e2c00000-0000-0000-0000-00000000000f';

  visitor_off  uuid;
  visitor_on   uuid;
  visitor_bad  uuid;
  visitor_old  uuid;
  visitor_lost uuid;
  visitor_b    uuid;

  today_a date;
  n integer;
  msg public.notification_messages;
  failed boolean;
  body_now text;
  reach boolean;
  gw boolean;
begin
  insert into public.orgs (id, name, slug) values
    (org_a, 'Foxtrot Fitness', 'foxtrot-fitness-test'),
    (org_b, 'Golf Fitness',    'golf-fitness-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Foxtrot One'),
    (br_a2, org_a, 'Foxtrot Two'),
    (br_b1, org_b, 'Golf One');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_a_owner,   org_a, 'Foxtrot Owner',   'owner@foxtrot.test',   'owner',      '{}',         'active'),
    (st_a_desk,    org_a, 'Foxtrot Desk',    'desk@foxtrot.test',    'front_desk', array[br_a1], 'active'),
    (st_a_trainer, org_a, 'Foxtrot Trainer', 'trainer@foxtrot.test', 'trainer',    array[br_a1], 'active'),
    (st_b_owner,   org_b, 'Golf Owner',      'owner@golf.test',      'owner',      '{}',         'active');

  today_a := public.org_today(org_a);

  -- A gateway exists, so nothing below is skipped for want of one. `log_only`
  -- is the pipeline's own gateway: real rows, no HTTP.
  insert into public.notification_providers (org_id, channel, provider, sender_id)
  values (org_a, 'sms', 'log_only', 'Foxtrot');

  -- seeded rules: both visitor rules exist, both off ------------------------
  select count(*) into n from public.notification_rules
   where org_id = org_a
     and event in ('visitor_welcome'::public.notification_event,
                   'visitor_follow_up'::public.notification_event);
  assert n = 2, format('expected two visitor rules, found %s', n);

  select count(*) into n from public.notification_rules
   where org_id = org_a
     and event in ('visitor_welcome'::public.notification_event,
                   'visitor_follow_up'::public.notification_event)
     and enabled;
  assert n = 0, 'visitor rules must arrive switched off';

  -- the welcome does not fire while the rule is off -------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  insert into public.visitors (org_id, branch_id, full_name, phone)
  values (org_a, br_a1, 'Rule Off', '9801111111')
  returning id into visitor_off;

  execute 'reset role';
  select count(*) into n from public.notification_messages where visitor_id = visitor_off;
  assert n = 0, 'a disabled rule still queued a welcome';

  -- switched on, the welcome rides the insert -------------------------------
  update public.notification_rules set enabled = true
   where org_id = org_a
     and event in ('visitor_welcome'::public.notification_event,
                   'visitor_follow_up'::public.notification_event);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  insert into public.visitors (org_id, branch_id, full_name, phone, interested_plan_id)
  values (org_a, br_a1, 'Sita Rai', '9802222222', null)
  returning id into visitor_on;

  -- A number that is not a mobile number still gets a row, so the mistyped
  -- digit is visible in the log rather than silently dropped.
  insert into public.visitors (org_id, branch_id, full_name, phone)
  values (org_a, br_a1, 'Bad Number', '12')
  returning id into visitor_bad;

  execute 'reset role';

  select * into msg from public.notification_messages where visitor_id = visitor_on;
  assert found, 'the welcome was not queued';
  assert msg.event = 'visitor_welcome'::public.notification_event, 'wrong event on the welcome';
  assert msg.status = 'queued'::public.notification_status,
    format('welcome status was %s', msg.status);
  assert msg.member_id is null, 'a visitor welcome must not carry a member';
  assert msg.branch_id = br_a1, 'the welcome lost the branch it happened at';
  assert msg.dedupe_key = 'visitor_welcome:' || visitor_on::text, 'wrong dedupe key';
  assert msg.body like '%Sita Rai%', format('the name was not rendered: %s', msg.body);
  assert msg.body like '%Foxtrot Fitness%', 'the gym name was not rendered';
  assert msg.body not like '%{{%', format('a placeholder survived: %s', msg.body);

  select * into msg from public.notification_messages where visitor_id = visitor_bad;
  assert found, 'the unusable number got no row at all';
  assert msg.status = 'skipped'::public.notification_status,
    format('an unusable number produced %s', msg.status);

  -- the follow-up sweep ------------------------------------------------------
  -- Visited three days ago, still open: the rule's own offset.
  insert into public.visitors (org_id, branch_id, full_name, phone, visited_on, status)
  values (org_a, br_a1, 'Old Visit', '9803333333', today_a - 3, 'new')
  returning id into visitor_old;

  insert into public.visitors (org_id, branch_id, full_name, phone, visited_on, status)
  values (org_a, br_a1, 'Said No', '9804444444', today_a - 3, 'lost')
  returning id into visitor_lost;

  -- A walk-in at the other branch, logged here rather than by the desk: RLS
  -- would refuse the desk this insert, which is a different rule being tested
  -- further down.
  insert into public.visitors (org_id, branch_id, full_name, phone)
  values (org_a, br_a2, 'Other Branch', '9805555555')
  returning id into visitor_b;

  perform set_config('request.jwt.claims', null, true);
  n := public.enqueue_visitor_follow_ups();
  assert n = 1, format('the sweep queued %s follow-ups, expected 1', n);

  select count(*) into n from public.notification_messages
   where visitor_id = visitor_old
     and event = 'visitor_follow_up'::public.notification_event;
  assert n = 1, 'the open visitor got no follow-up';

  select count(*) into n from public.notification_messages
   where visitor_id = visitor_lost;
  assert n = 0, '"not joining" was chased anyway';

  -- Back-dated rows get no welcome: the wording thanks them for coming in
  -- today, and they did not.
  select count(*) into n from public.notification_messages
   where visitor_id = visitor_old
     and event = 'visitor_welcome'::public.notification_event;
  assert n = 0, 'a visit logged for an earlier day still triggered the welcome';

  -- Twice in one night, or a changed offset, must not text anyone twice.
  n := public.enqueue_visitor_follow_ups();
  assert n = 0, format('a second sweep queued %s more', n);

  update public.notification_rules set offset_days = 5
   where org_id = org_a and event = 'visitor_follow_up'::public.notification_event;
  update public.visitors set visited_on = today_a - 5 where id = visitor_old;
  n := public.enqueue_visitor_follow_ups();
  assert n = 0, 'moving the offset re-texted somebody who already had one';

  -- the manual send ----------------------------------------------------------
  -- A trainer may log a walk-in and may not text one.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_trainer::text,
    'staff_role', 'trainer', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.send_visitor_notification(
      visitor_old, 'visitor_follow_up'::public.notification_event);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a trainer sent a visitor an SMS';

  -- The desk, at its own branch.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  select body, reachable, has_gateway into body_now, reach, gw
    from public.visitor_notification_preview(
      visitor_on, 'visitor_welcome'::public.notification_event);
  assert reach, 'a good mobile number read as unreachable';
  assert gw, 'the active gateway was not seen';
  assert body_now like '%Sita Rai%', 'the preview did not render the name';

  -- A custom message is written by the desk, so the preview has no body.
  select body into body_now from public.visitor_notification_preview(
    visitor_on, 'custom_message'::public.notification_event);
  assert body_now is null, 'a custom message came back pre-written';

  failed := false;
  begin
    perform public.send_visitor_notification(
      visitor_on, 'custom_message'::public.notification_event, 'sms', '   ');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a blank custom message was accepted';

  -- Dues and birthdays are not things this product knows about a walk-in.
  failed := false;
  begin
    perform public.send_visitor_notification(
      visitor_on, 'dues_reminder'::public.notification_event, 'sms', 'You owe us');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a visitor was sent a dues reminder';

  perform public.send_visitor_notification(
    visitor_on, 'custom_message'::public.notification_event, 'sms',
    'Your trial pass is ready at the desk.');

  select * into msg from public.notification_messages
   where visitor_id = visitor_on
     and event = 'custom_message'::public.notification_event;
  assert found, 'the manual send wrote nothing';
  assert msg.body = 'Your trial pass is ready at the desk.', 'the body was not what was typed';
  assert msg.created_by = st_a_desk, 'the sender was not recorded';
  assert msg.status = 'queued'::public.notification_status, 'the manual send did not queue';

  -- A double click inside the window is one message, not two.
  failed := false;
  begin
    perform public.send_visitor_notification(
      visitor_on, 'custom_message'::public.notification_event, 'sms',
      'Your trial pass is ready at the desk.');
  exception when unique_violation then failed := true;
  end;
  assert failed, 'a double click sent a second SMS';

  -- A branch the desk does not cover.
  failed := false;
  begin
    perform public.send_visitor_notification(
      visitor_b, 'visitor_welcome'::public.notification_event);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'the desk texted a visitor at a branch it does not cover';

  -- Cross-tenant: org B's owner cannot see or send to org A's walk-in.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.visitor_notification_preview(
      visitor_on, 'visitor_welcome'::public.notification_event);
  exception when no_data_found then failed := true;
  end;
  assert failed, 'org B previewed org A''s visitor';

  select count(*) into n from public.notification_messages where org_id = org_a;
  assert n = 0, format('org B read %s of org A''s messages', n);

  -- The internal target function is callable by no client role.
  failed := false;
  begin
    perform public.visitor_message_target(visitor_on);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'visitor_message_target is callable by a client role';

  -- teardown -----------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'visitor_messages: all assertions passed';
end $$;
