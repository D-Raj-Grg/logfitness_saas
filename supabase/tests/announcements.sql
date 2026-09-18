-- Gate for announcements (2026-09-17): the broadcast composer. Who may spend
-- the gym's SMS credit, who ends up in the audience, that the count the desk
-- is shown is the number of rows that get written, that a scheduled send sits
-- in the outbox until its hour, and that cancelling stops only what has not
-- gone yet.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/announcements.sql

do $$
declare
  org_a uuid := 'e3e3e3e3-3333-3333-3333-333333333333';
  org_b uuid := 'e4e4e4e4-4444-4444-4444-444444444444';
  br_a1 uuid := 'e3b10000-0000-0000-0000-000000000001';
  br_a2 uuid := 'e3b10000-0000-0000-0000-000000000002';
  br_b1 uuid := 'e4b10000-0000-0000-0000-000000000001';

  st_a_owner   uuid := 'e3c00000-0000-0000-0000-00000000000f';
  st_a_manager uuid := 'e3c00000-0000-0000-0000-0000000000aa';
  st_a_desk    uuid := 'e3c00000-0000-0000-0000-0000000000cd';
  st_a_trainer uuid := 'e3c00000-0000-0000-0000-0000000000c0';
  st_b_owner   uuid := 'e4c00000-0000-0000-0000-00000000000f';

  mem_ok1  uuid := 'e3d00000-0000-0000-0000-000000000001';  -- branch one, textable
  mem_ok2  uuid := 'e3d00000-0000-0000-0000-000000000002';  -- branch two, textable
  mem_bad  uuid := 'e3d00000-0000-0000-0000-000000000003';  -- a landline
  mem_out  uuid := 'e3d00000-0000-0000-0000-000000000004';  -- opted out
  mem_arch uuid := 'e3d00000-0000-0000-0000-000000000005';  -- archived
  mem_left uuid := 'e3d00000-0000-0000-0000-000000000006';  -- has left the gym

  vis_new  uuid;
  vis_old  uuid;
  vis_lost uuid;
  vis_conv uuid;
  vis_dup  uuid;

  ann_desk uuid;  -- sent by the front desk, their branch only
  ann_mgr uuid;   -- sent by the manager, their branch only
  ann_m   uuid;   -- audience: members
  ann_v   uuid;   -- audience: visitors
  ann_b   uuid;   -- audience: both
  ann_br  uuid;   -- audience: members, one branch
  ann_vd  uuid;   -- audience: visitors, within N days
  ann_s   uuid;   -- scheduled for the day after tomorrow
  ann_em  uuid;   -- the email channel, where visitors have no address at all
  ann_s2  uuid;   -- scheduled, and left alone, so `state` has something to read
  msg_t   uuid;   -- the test send, which belongs to no announcement at all

  c_total integer; c_reach integer; c_unusable integer;
  c_members integer; c_visitors integer;

  today_a date;
  n integer;
  s text;
  msg public.notification_messages;
  failed boolean;
begin
  ------------------------------------------------------------------ fixtures
  insert into public.orgs (id, name, slug) values
    (org_a, 'Papa Fitness',   'papa-fitness-announce-test'),
    (org_b, 'Quebec Fitness', 'quebec-fitness-announce-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Papa One'),
    (br_a2, org_a, 'Papa Two'),
    (br_b1, org_b, 'Quebec One');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_a_owner,   org_a, 'Papa Owner',   'owner@papa.test',   'owner',      '{}',         'active'),
    (st_a_manager, org_a, 'Papa Manager', 'manager@papa.test', 'manager',    array[br_a1], 'active'),
    (st_a_desk,    org_a, 'Papa Desk',    'desk@papa.test',    'front_desk', array[br_a1], 'active'),
    (st_a_trainer, org_a, 'Papa Coach',   'coach@papa.test',   'trainer',    array[br_a1], 'active'),
    (st_b_owner,   org_b, 'Quebec Owner', 'owner@quebec.test', 'owner',      '{}',         'active');

  today_a := public.org_today(org_a);

  -- `log_only` is the pipeline's own gateway: real rows, no HTTP. It exists so
  -- that the worker further down claims and completes for real.
  insert into public.notification_providers (org_id, channel, provider, sender_id)
  values (org_a, 'sms', 'log_only', 'PapaGym');

  insert into public.members (id, org_id, home_branch_id, member_code, full_name, phone, joined_on)
  values
    (mem_ok1,  org_a, br_a1, 'P-0001', 'Anita Gurung',   '9800000201', today_a),
    (mem_ok2,  org_a, br_a2, 'P-0002', 'Bikash Thapa',   '9800000202', today_a),
    (mem_bad,  org_a, br_a1, 'P-0003', 'Landline Lama',  '01-4567890', today_a),
    (mem_out,  org_a, br_a1, 'P-0004', 'Opted Out',      '9800000204', today_a),
    (mem_arch, org_a, br_a1, 'P-0005', 'Archived Ale',   '9800000205', today_a),
    (mem_left, org_a, br_a1, 'P-0006', 'Left Limbu',     '9800000206', today_a);

  update public.members set notifications_opt_out = true where id = mem_out;
  update public.members set archived_at = now(), archived_reason = 'test' where id = mem_arch;
  -- `status` is trigger-derived: setting the leaving date is how a member
  -- becomes `left`, never an assignment to the column.
  update public.members set left_on = today_a, left_reason = 'moved away' where id = mem_left;

  select status into s from public.members where id = mem_left;
  assert s = 'left', format('the fixture member did not derive to left, saw %s', s);

  insert into public.visitors (org_id, branch_id, full_name, phone, visited_on, status)
  values (org_a, br_a1, 'Nabin New', '9800000301', today_a, 'new')
  returning id into vis_new;

  insert into public.visitors (org_id, branch_id, full_name, phone, visited_on, status)
  values (org_a, br_a1, 'Chhiring Called', '9800000302', today_a - 10, 'contacted')
  returning id into vis_old;

  insert into public.visitors (org_id, branch_id, full_name, phone, visited_on, status)
  values (org_a, br_a1, 'Said No', '9800000303', today_a, 'lost')
  returning id into vis_lost;

  insert into public.visitors (org_id, branch_id, full_name, phone, visited_on, status,
                               converted_member_id, converted_at)
  values (org_a, br_a1, 'Joined Already', '9800000304', today_a, 'converted', mem_ok1, now())
  returning id into vis_conv;

  -- The same human being, twice in the database: he walked in, was logged as a
  -- visitor, and his number is the one Anita Gurung is a member under. Written
  -- with a country code and a space so that only normalisation catches it.
  insert into public.visitors (org_id, branch_id, full_name, phone, visited_on, status)
  values (org_a, br_a1, 'Dipesh Twice', '+977 9800000201', today_a, 'new')
  returning id into vis_dup;

  ------------------------------------------------------------ who may send
  -- A broadcast cannot be taken back one row at a time, so who may send one is
  -- the question this block answers. Widened on 2026-09-18
  -- (`20260918100000_announcement_front_desk.sql`): the desk announces too,
  -- because the person standing at the door on the morning the gym is shut is
  -- the one who knows. What did not widen is the reach --
  -- `announcement_branch_scope` resolves a non-owner to their own branches,
  -- and a desk with no branch of its own is refused rather than handed the
  -- chain, which is what an empty claim would otherwise mean.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  -- The desk may price a send...
  select reachable into n from public.announcement_audience_count('members');
  assert n > 0, 'the front desk could not count the audience for a send it may make';

  -- ...and make it. Branch one only: `mem_ok2` is at branch two and the desk
  -- has no claim on it, so a desk announcement that reached him would be the
  -- chain being texted by one gym's front desk.
  ann_desk := public.send_announcement(
    'Closed Sunday', 'We are shut on Sunday.', 'members'
  );

  assert exists (
    select 1 from public.notification_messages
    where announcement_id = ann_desk and member_id = mem_ok1
  ), 'the desk announcement missed the member at its own branch';

  assert not exists (
    select 1 from public.notification_messages
    where announcement_id = ann_desk and member_id = mem_ok2
  ), 'the front desk announced to a branch it has no claim on';

  execute 'reset role';

  -- A desk with no branch of its own is the hole the old rule was guarding:
  -- an empty `branch_ids` claim means "every branch" to
  -- `announcement_branch_scope`, so it is refused outright.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.send_announcement('Closed Sunday', 'We are shut on Sunday.', 'members');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a front desk with no branch of its own announced to the whole chain';

  failed := false;
  begin
    perform public.announcement_audience_count('members');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a front desk with no branch of its own could price a send it may not make';

  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_trainer::text,
    'staff_role', 'trainer', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.send_announcement('Closed Sunday', 'We are shut on Sunday.', 'members');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a trainer sent the whole gym an SMS';

  failed := false;
  begin
    perform public.announcement_audience_count('members');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a trainer could price a broadcast';

  failed := false;
  begin
    perform public.send_announcement_test('We are shut on Sunday.', '9800000201');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a trainer sent an announcement test';

  -- A manager may, and gets their own branches and no others: the scope is
  -- resolved for them rather than asked for, so "all branches" from a manager
  -- is not the chain.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_manager::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  ann_mgr := public.send_announcement(
    'Branch One Notice', 'Papa One shuts at 6pm today.', 'members');
  assert ann_mgr is not null, 'a manager could not send an announcement';

  select count(*) into n from public.notification_messages where announcement_id = ann_mgr;
  assert n = 2, format('the manager reached %s people, expected their branch''s 2', n);

  select count(*) into n from public.notification_messages
   where announcement_id = ann_mgr and member_id = mem_ok2;
  assert n = 0, 'a manager''s branch announcement reached another branch''s member';

  -- An explicit branch outside the manager's access is refused rather than
  -- quietly narrowed, because a narrowed send looks like it worked.
  failed := false;
  begin
    perform public.send_announcement(
      'Wrong Branch', 'Not your branch.', 'members', 'sms', br_a2);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a manager announced at a branch they do not cover';

  execute 'reset role';

  ------------------------------------------------------- the owner, members
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  ann_m := public.send_announcement(
    'Vishwakarma Puja', 'Hi {{name}}, {{gym_name}} is closed for Vishwakarma Puja.',
    'members');

  -- Anita, Bikash and the landline. Three rows, one per eligible member, and
  -- nothing at all for the three who are not eligible.
  select count(*) into n from public.notification_messages where announcement_id = ann_m;
  assert n = 3, format('the members fan-out wrote %s rows, expected 3', n);

  select * into msg from public.notification_messages
   where announcement_id = ann_m and member_id = mem_ok1;
  assert found, 'the textable member got no row';
  assert msg.event = 'announcement'::public.notification_event,
    format('wrong event on a broadcast row: %s', msg.event);
  assert msg.announcement_id = ann_m, 'the row does not point back at its broadcast';
  assert msg.visitor_id is null, 'a member row must not carry a visitor';
  assert msg.branch_id = br_a1, 'the row lost the member''s home branch';
  assert msg.to_address = '9800000201', format('wrong address: %s', msg.to_address);
  assert msg.status = 'queued'::public.notification_status,
    format('a good number produced %s', msg.status);
  assert msg.created_by = st_a_owner, 'the sender was not recorded';
  assert msg.dedupe_key = 'announcement:' || ann_m::text || ':member:' || mem_ok1::text,
    format('wrong dedupe key: %s', msg.dedupe_key);

  -- Rendered at enqueue time, per recipient: editing the announcement
  -- afterwards cannot change what somebody was told.
  assert msg.body like '%Anita Gurung%', format('the name was not rendered: %s', msg.body);
  assert msg.body like '%Papa Fitness%', 'the gym name was not rendered';
  assert msg.body !~ '\{\{', format('a placeholder survived: %s', msg.body);

  -- Consent: not a skipped row, not a cancelled row -- no row. An opt-out is a
  -- standing instruction and an announcement is the least urgent thing here.
  select count(*) into n from public.notification_messages
   where announcement_id = ann_m and member_id = mem_out;
  assert n = 0, 'an opted-out member was put in the outbox anyway';

  select count(*) into n from public.notification_messages
   where announcement_id = ann_m and member_id in (mem_arch, mem_left);
  assert n = 0, format('%s rows went to members who are off the floor', n);

  -- An unusable number is visible, not dropped: the desk finds out the digit
  -- was mistyped by reading the log, not by wondering.
  select * into msg from public.notification_messages
   where announcement_id = ann_m and member_id = mem_bad;
  assert found, 'the unusable number got no row at all';
  assert msg.status = 'skipped'::public.notification_status,
    format('an unusable number produced %s', msg.status);
  assert msg.last_error like 'No usable%',
    format('a skipped row must say why: %s', coalesce(msg.last_error, '(null)'));
  assert msg.to_address = '01-4567890',
    'the skipped row shows the number as typed, so the mistake is findable';

  -- `left` is only excluded while the filter is absent. Asked for by name,
  -- they are the audience -- "we reopen on Monday" is a win-back.
  select count(*) into n
  from public.announcement_audience_count('members', null, array['left']::public.member_status[]);
  assert n = 1, 'the count returns exactly one row';
  select total into n
  from public.announcement_audience_count('members', null, array['left']::public.member_status[]);
  assert n = 1, format('an explicit left filter found %s, expected 1', n);

  ------------------------------------------------------------------ visitors
  ann_v := public.send_announcement(
    'Open House', 'Come and see us, {{name}}.', 'visitors');

  select count(*) into n from public.notification_messages where announcement_id = ann_v;
  assert n = 3, format('the visitor fan-out wrote %s rows, expected 3', n);

  select count(*) into n from public.notification_messages
   where announcement_id = ann_v and visitor_id in (vis_new, vis_old, vis_dup);
  assert n = 3, 'an open walk-in was left out';

  -- `lost` asked not to be chased; `converted` is a member now and would be
  -- told twice.
  select count(*) into n from public.notification_messages
   where announcement_id = ann_v and visitor_id in (vis_lost, vis_conv);
  assert n = 0, format('%s rows went to walk-ins who said no or already joined', n);

  select * into msg from public.notification_messages
   where announcement_id = ann_v and visitor_id = vis_new;
  assert msg.member_id is null, 'a visitor row must not carry a member';
  assert msg.dedupe_key = 'announcement:' || ann_v::text || ':visitor:' || vis_new::text,
    format('wrong visitor dedupe key: %s', msg.dedupe_key);

  ------------------------------------------- both, and the count that agrees
  -- The preview and the send call the same audience function with the same
  -- arguments, so this is the assertion that the number the desk was shown is
  -- the number of messages the gym paid for. Taken first, then compared with
  -- what the send actually wrote.
  select total, reachable, unusable, members, visitors
    into c_total, c_reach, c_unusable, c_members, c_visitors
    from public.announcement_audience_count('both');

  assert c_total = 5, format('the preview counted %s for both, expected 5', c_total);
  assert c_reach = 4 and c_unusable = 1,
    format('the preview split %s reachable / %s unusable, expected 4 / 1', c_reach, c_unusable);
  assert c_members = 3 and c_visitors = 2,
    format('the preview saw %s members and %s visitors, expected 3 and 2', c_members, c_visitors);

  ann_b := public.send_announcement('Dashain Hours', 'Festival timings, {{name}}.', 'both');

  select count(*) into n from public.notification_messages where announcement_id = ann_b;
  assert n = c_total, format('the preview promised %s rows and the send wrote %s', c_total, n);

  select count(*) into n from public.notification_messages
   where announcement_id = ann_b and status = 'queued'::public.notification_status;
  assert n = c_reach, format('the preview promised %s reachable and %s queued', c_reach, n);

  select count(*) into n from public.notification_messages
   where announcement_id = ann_b and status = 'skipped'::public.notification_status;
  assert n = c_unusable, format('the preview promised %s unusable and %s skipped', c_unusable, n);

  select count(*) into n from public.notification_messages
   where announcement_id = ann_b and member_id is not null;
  assert n = c_members, format('the preview promised %s members and %s were written', c_members, n);

  -- "Both" means both groups of people, not both rows. Dipesh is in the
  -- visitor log and is also a member; he is texted once, as the member, so the
  -- wording that reaches him is the one meant for somebody who already pays.
  select count(*) into n from public.notification_messages
   where announcement_id = ann_b and visitor_id = vis_dup;
  assert n = 0, 'the walk-in duplicate of a member was texted a second time';

  select count(*) into n from public.notification_messages
   where announcement_id = ann_b and member_id = mem_ok1;
  assert n = 1, 'and the member himself lost his row to the de-duplication';

  select count(*) into n from public.notification_messages
   where announcement_id = ann_b and to_address = '9800000201';
  assert n = 1, format('one human being got %s messages', n);

  ------------------------------------------------------------- the filters
  -- A branch announcement is the common case: one gym in a chain has a burst
  -- pipe and the other two do not need to hear about it.
  ann_br := public.send_announcement(
    'Papa Two Only', 'Papa Two is shut this evening.', 'members', 'sms', br_a2);

  select count(*) into n from public.notification_messages where announcement_id = ann_br;
  assert n = 1, format('the branch filter wrote %s rows, expected 1', n);

  select count(*) into n from public.notification_messages
   where announcement_id = ann_br and member_id = mem_ok2;
  assert n = 1, 'the branch filter picked the wrong member';

  -- `visited_on`, not `created_at`: a walk-in logged this morning for last
  -- week is last week's walk-in.
  ann_vd := public.send_announcement(
    'Recent Walk-ins', 'Still thinking about it, {{name}}?', 'visitors',
    'sms', null, null, 5);

  select count(*) into n from public.notification_messages where announcement_id = ann_vd;
  assert n = 2, format('the five-day window caught %s walk-ins, expected 2', n);

  select count(*) into n from public.notification_messages
   where announcement_id = ann_vd and visitor_id = vis_old;
  assert n = 0, 'a walk-in from ten days ago was inside a five-day window';

  -- The branch an owner names still has to exist in their own chain; a branch
  -- id from elsewhere is not a way to read another gym's list. Refused at the
  -- door with a sentence rather than at the foreign key with a `23503`:
  -- `has_branch_access` short-circuits on ownership and never asks whose
  -- branch it is, which is what 20260917100300 added the org check for.
  failed := false;
  begin
    perform public.send_announcement(
      'Other Chain', 'Should never send.', 'members', 'sms', br_b1);
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'an owner announced at a branch belonging to another org';

  ------------------------------------------------------------------- email
  -- A walk-in leaves a phone number and nothing else, so there is no such
  -- thing as an email audience of visitors: they are left out rather than
  -- written into the log as several hundred unsendable rows addressed by
  -- telephone. A member with no email on file is still recorded as skipped,
  -- but the address in that row is an email column's worth of nothing, not
  -- their mobile. Both are 20260917100300.
  ann_em := public.send_announcement(
    'Closed Friday', 'We are closed on Friday.', 'both', 'email');

  select count(*) into n from public.notification_messages
   where announcement_id = ann_em and visitor_id is not null;
  assert n = 0, format('an email announcement was addressed to %s walk-ins', n);

  select count(*) into n from public.notification_messages
   where announcement_id = ann_em
     and to_address ~ '^[0-9+][0-9 +-]*$';
  assert n = 0, 'an email announcement carried a phone number as its address';

  ------------------------------------------------------------ empty audience
  -- The desk picked a filter that matches nobody. That is a mistake being made,
  -- not a send: it must leave no announcement behind to read as "sent to 0".
  failed := false;
  begin
    perform public.send_announcement(
      'Nobody Home', 'Anyone there?', 'members', 'sms', br_a2,
      array['left']::public.member_status[]);
  exception when no_data_found then failed := true; s := sqlerrm;
  end;
  assert failed, 'an announcement addressed to nobody was accepted';
  assert s = 'Nobody matches that audience', format('unexpected wording: %s', s);

  execute 'reset role';
  select count(*) into n from public.announcements
   where org_id = org_a and title = 'Nobody Home';
  assert n = 0, 'the refused send still left an announcement row behind';

  ------------------------------------------------------------------ schedule
  -- Scheduling is not a scheduler. The rows are written now, dated forward,
  -- and the one-minute worker simply does not see them yet -- which is also
  -- why a scheduled announcement is in the delivery log from the moment it is
  -- composed rather than appearing out of nowhere on the day.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  ann_s := public.send_announcement(
    'Tuesday Closure', 'We are shut on Tuesday, {{name}}.', 'both',
    'sms', null, null, null, now() + interval '2 days');

  -- A time already gone is refused; a minute of slack for the composer's clock
  -- is the only latitude.
  failed := false;
  begin
    perform public.send_announcement(
      'Last Week', 'Too late.', 'members', 'sms', null, null, null,
      now() - interval '2 hours');
  exception when check_violation then failed := true;
  end;
  assert failed, 'an announcement was scheduled into the past';

  execute 'reset role';

  select status into s from public.announcements where id = ann_s;
  assert s = 'scheduled', format('a forward-dated send reads as %s', s);

  select count(*) into n from public.notification_messages
   where announcement_id = ann_s and next_attempt_at > now() + interval '1 day';
  assert n = 5, format('%s of the scheduled rows are due in the future, expected 5', n);

  -- Run the worker exactly as pg_cron runs it: no claims at all.
  perform set_config('request.jwt.claims', null, true);
  select public.send_notification_batch(200) into n;
  assert n >= 1, format('the worker dispatched %s, expected the due rows', n);

  select count(*) into n from public.notification_messages
   where announcement_id = ann_s
     and status <> 'queued'::public.notification_status
     and status <> 'skipped'::public.notification_status;
  assert n = 0, format('the worker claimed %s rows that are not due until Tuesday', n);

  select count(*) into n from public.notification_messages
   where announcement_id = ann_m and status = 'sent'::public.notification_status;
  assert n = 2, format('the due broadcast only got %s of its 2 rows out', n);

  ------------------------------------------------------------------- cancel
  -- The worker has got to one of them before the owner changed their mind.
  -- An SMS cannot be recalled, so that row is history and must read as sent
  -- afterwards; rewriting it would be a lie about what a member received.
  update public.notification_messages
     set status = 'sent'::public.notification_status, sent_at = now()
   where id = (select id from public.notification_messages
                where announcement_id = ann_s
                  and status = 'queued'::public.notification_status
                order by id limit 1);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  n := public.cancel_announcement(ann_s);
  assert n = 3, format('cancelling stopped %s, expected the 3 still queued', n);

  execute 'reset role';

  select count(*) into n from public.notification_messages
   where announcement_id = ann_s and status = 'cancelled'::public.notification_status;
  assert n = 3, format('%s rows were cancelled, expected 3', n);

  select count(*) into n from public.notification_messages
   where announcement_id = ann_s and status = 'sent'::public.notification_status;
  assert n = 1, 'the row that had already gone out was rewritten by the cancel';

  select count(*) into n from public.notification_messages
   where announcement_id = ann_s and status = 'skipped'::public.notification_status;
  assert n = 1, 'the skipped row was swept up by the cancel';

  select last_error into s from public.notification_messages
   where announcement_id = ann_s and status = 'cancelled'::public.notification_status limit 1;
  assert s = 'The announcement was cancelled', format('a cancelled row says: %s', s);

  select status into s from public.announcements where id = ann_s;
  assert s = 'cancelled', format('the announcement itself reads as %s', s);

  -- Cancelling one that has entirely gone out stops nothing and rewrites
  -- nothing. The count is what the screen says out loud, so zero has to be
  -- reachable rather than an error.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  n := public.cancel_announcement(ann_m);
  assert n = 0, format('cancelling a finished broadcast claimed to stop %s', n);

  execute 'reset role';

  select count(*) into n from public.notification_messages
   where announcement_id = ann_m and status = 'sent'::public.notification_status;
  assert n = 2, 'cancelling a finished broadcast rewrote what members had received';

  ---------------------------------------------------------------- the list
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_manager::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  -- Read is org-wide on purpose: a manager who cannot see that the owner
  -- announced a national closure will announce it again.
  select count(*) into n from public.announcement_overview where id = ann_br;
  assert n = 1, 'a manager cannot see a broadcast made at another branch';

  select total, sent, skipped into c_total, c_reach, c_unusable
    from public.announcement_overview where id = ann_m;
  assert c_total = 3 and c_reach = 2 and c_unusable = 1,
    format('the overview counts %s / %s sent / %s skipped, expected 3 / 2 / 1',
           c_total, c_reach, c_unusable);

  -- `status` is what was asked for and never moves again; `state` is what is
  -- true now, derived from the outbox. The two part company the moment a
  -- scheduled hour passes, which is the whole reason 20260917100200 exists.
  select state into s from public.announcement_overview where id = ann_m;
  assert s = 'sent', format('a finished broadcast reads as %s', s);

  -- Cancelled beats an hour that has not arrived: `ann_s` was scheduled and
  -- then stopped, and what matters about it now is that it was stopped.
  select state into s from public.announcement_overview where id = ann_s;
  assert s = 'cancelled', format('a stopped broadcast reads as %s', s);

  -- So the forward-dated branch needs one that nobody cancelled.
  ann_s2 := public.send_announcement(
    'Holiday Hours', 'We open late on Friday.', 'members', 'sms', null, null,
    null, now() + interval '2 days');

  select state into s from public.announcement_overview where id = ann_s2;
  assert s = 'scheduled', format('a broadcast dated forward reads as %s', s);

  execute 'reset role';

  -- A cancel that stopped nothing must not relabel a send that had already
  -- completed: the log would then disagree with what members received.
  select status::text into s from public.announcements where id = ann_m;
  assert s <> 'cancelled', 'a no-op cancel marked a finished broadcast cancelled';

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_manager::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  execute 'reset role';

  ------------------------------------------------------------- cross-tenant
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.announcements where org_id = org_a;
  assert n = 0, format('org B read %s of org A''s announcements', n);

  select count(*) into n from public.announcement_overview where org_id = org_a;
  assert n = 0, format('org B read %s of org A''s announcements through the view', n);

  select count(*) into n from public.notification_messages where announcement_id = ann_m;
  assert n = 0, 'org B read org A''s broadcast messages';

  -- Not just the table: the RPC takes an id, so it must not be a way round it.
  failed := false;
  begin
    perform public.cancel_announcement(ann_br);
  exception when no_data_found then failed := true;
  end;
  assert failed, 'org B cancelled org A''s announcement';

  select count(*) into n from public.notification_messages
   where announcement_id = ann_br and status = 'cancelled'::public.notification_status;
  assert n = 0, 'org B''s cancel attempt still changed org A''s outbox';

  -- And counting is reading: org B's own gym is empty, and an audience count
  -- runs on the caller's org whatever it is handed.
  select total into n from public.announcement_audience_count('both');
  assert n = 0, format('org B counted %s recipients out of an empty gym', n);

  execute 'reset role';

  --------------------------------------------------------------- test send
  -- One number, typed by hand, before four hundred. It renders through the
  -- same path the real send uses, so what arrives on the handset is what the
  -- members would have got -- and it deliberately writes no announcement row,
  -- because nothing has been announced yet.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  -- Counted before and after rather than looked up by title: an announcement
  -- earlier in this file is already called "Closed Friday", and a test that
  -- passes because two strings differ is not testing anything.
  select count(*) into c_total from public.announcements where org_id = org_a;

  msg_t := public.send_announcement_test(
    'Closed Friday, {{name}}. -- {{gym_name}}', '98-0000-9999');

  execute 'reset role';

  select count(*) into n from public.notification_messages
   where id = msg_t
     and event = 'announcement'::public.notification_event
     and announcement_id is null
     and member_id is null
     and visitor_id is null
     and to_address = '9800009999'
     and status = 'queued'::public.notification_status;
  assert n = 1, 'the test send did not write one unattached, queued row';

  select count(*) into n from public.announcements where org_id = org_a;
  assert n = c_total, format(
    'a test send left %s announcement rows behind', n - c_total);

  -- The sender's own name stands in, so a `{{name}}` that renders to nothing
  -- shows up as a hole on the handset rather than as nothing at all.
  select body into s from public.notification_messages where id = msg_t;
  assert s not like '%{{%', format('the test send left a placeholder: %s', s);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  -- A number nothing can be sent to refuses here rather than logging a
  -- `skipped` row: the whole point of a test is that a handset lights up, and
  -- a quiet row in the log reads exactly like a gateway that is not working.
  failed := false;
  begin
    perform public.send_announcement_test('Anything at all.', '01-4567890');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a landline was accepted as a test recipient';

  -- A double click costs a credit and proves nothing.
  failed := false;
  begin
    perform public.send_announcement_test(
      'Closed Friday, {{name}}. -- {{gym_name}}', '98-0000-9999');
  exception when unique_violation then failed := true;
  end;
  assert failed, 'the same test went out twice inside a minute';

  execute 'reset role';

  -- The desk proofs its own broadcast before spending the gym's credit on it.
  -- Testing is part of sending, so it moved with the send on 2026-09-18 rather
  -- than being left behind as the one step the desk may not take.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  assert public.send_announcement_test('Ours to send.', '9800009998') is not null,
    'the front desk could not proof its own announcement';

  execute 'reset role';

  -- A desk with no branch of its own may not, for the same reason it may not
  -- send: the guard is one predicate and the test send is behind it too.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  failed := false;
  begin
    perform public.send_announcement_test('Not yours to send.', '9800009997');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a front desk with no branch of its own proofed a broadcast';

  execute 'reset role';

  -------------------------------------------------------------- the grants
  -- The audience function reads members and visitors across a whole org with
  -- the branch scope passed in as an argument, which is only safe because the
  -- caller has already been checked. It must not be callable directly.
  assert not has_function_privilege('authenticated',
    'public.announcement_audience(uuid, uuid[], public.announcement_audience,'
    || ' public.member_status[], integer, public.notification_channel)', 'execute'),
    'the audience function is callable by a client role';

  assert has_function_privilege('authenticated',
    'public.send_announcement(text, text, public.announcement_audience,'
    || ' public.notification_channel, uuid, public.member_status[], integer, timestamptz)',
    'execute'),
    'the composer is not callable by the console';

  assert has_function_privilege('authenticated',
    'public.announcement_audience_count(public.announcement_audience, uuid,'
    || ' public.member_status[], integer, public.notification_channel)', 'execute'),
    'the preview count is not callable by the console';

  assert has_function_privilege('authenticated', 'public.cancel_announcement(uuid)', 'execute'),
    'cancel is not callable by the console';

  assert has_function_privilege('authenticated',
    'public.send_announcement_test(text, text, public.notification_channel, text)',
    'execute'),
    'the test send is not callable by the console';

  assert not has_function_privilege('anon',
    'public.send_announcement_test(text, text, public.notification_channel, text)',
    'execute'),
    'a signed-out caller can send an announcement test';

  assert not has_function_privilege('anon',
    'public.send_announcement(text, text, public.announcement_audience,'
    || ' public.notification_channel, uuid, public.member_status[], integer, timestamptz)',
    'execute'),
    'a signed-out caller can broadcast';

  ------------------------------------------------------------------ teardown
  perform set_config('request.jwt.claims', null, true);

  -- The walk-ins go first. `unconvert_visitors_of_deleted_member` fires as the
  -- org's members cascade away and updates the converted visitor's row, which
  -- re-checks its org foreign key against an org that is already gone.
  delete from public.visitors where org_id in (org_a, org_b);
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'announcements.sql: all assertions passed';
end $$;
