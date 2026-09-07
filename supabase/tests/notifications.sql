-- Gate for Phase 5 notifications (2026-09-09): who may configure a gateway,
-- who may read a delivery log, that a token can be written and never read back,
-- that the provider adapters shape the right request and read the right
-- verdict, and that a sweep run twice does not text anybody twice.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/notifications.sql

do $$
declare
  org_a uuid := 'e1e1e1e1-1111-1111-1111-111111111111';
  org_b uuid := 'e2e2e2e2-2222-2222-2222-222222222222';
  br_a1 uuid := 'e1b10000-0000-0000-0000-000000000001';
  br_a2 uuid := 'e1b10000-0000-0000-0000-000000000002';
  br_b1 uuid := 'e2b10000-0000-0000-0000-000000000001';

  st_a_owner   uuid := 'e1c00000-0000-0000-0000-00000000000f';
  st_a_manager uuid := 'e1c00000-0000-0000-0000-0000000000aa';
  st_a_desk    uuid := 'e1c00000-0000-0000-0000-0000000000cd';
  st_b_owner   uuid := 'e2c00000-0000-0000-0000-00000000000f';

  mem_1 uuid := 'e1d00000-0000-0000-0000-000000000001';  -- expiring, textable
  mem_2 uuid := 'e1d00000-0000-0000-0000-000000000002';  -- opted out
  mem_3 uuid := 'e1d00000-0000-0000-0000-000000000003';  -- archived
  mem_4 uuid := 'e1d00000-0000-0000-0000-000000000004';  -- unusable phone
  mem_5 uuid := 'e1d00000-0000-0000-0000-000000000005';  -- birthday today

  plan_a uuid := 'e1e00000-0000-0000-0000-0000000000a1';
  prov_a uuid;
  msg_1 uuid;
  msg_2 uuid;

  today_a date;
  n integer;
  s text;
  j jsonb;
  failed boolean;
begin
  ------------------------------------------------------------------ fixtures
  insert into public.orgs (id, name, slug) values
    (org_a, 'Nova Fitness', 'nova-fitness-notif-test'),
    (org_b, 'Nyx Fitness',  'nyx-fitness-notif-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Nova One'),
    (br_a2, org_a, 'Nova Two'),
    (br_b1, org_b, 'Nyx One');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_a_owner,   org_a, 'Nova Owner',   'owner@nova.test',   'owner',      '{}',          'active'),
    (st_a_manager, org_a, 'Nova Manager', 'manager@nova.test', 'manager',    array[br_a1],  'active'),
    (st_a_desk,    org_a, 'Nova Desk',    'desk@nova.test',    'front_desk', array[br_a1],  'active'),
    (st_b_owner,   org_b, 'Nyx Owner',    'owner@nyx.test',    'owner',      '{}',          'active');

  today_a := public.org_today(org_a);

  insert into public.members (id, org_id, home_branch_id, member_code, full_name, phone, joined_on, date_of_birth)
  values
    (mem_1, org_a, br_a1, 'N-0001', 'Expiring Member', '9800000101', today_a, null),
    (mem_2, org_a, br_a1, 'N-0002', 'Opted Out',       '9800000102', today_a, null),
    (mem_3, org_a, br_a1, 'N-0003', 'Archived Member', '9800000103', today_a, null),
    (mem_4, org_a, br_a1, 'N-0004', 'Bad Number',      '01-4567890', today_a, null),
    (mem_5, org_a, br_a2, 'N-0005', 'Birthday Member', '9800000105', today_a,
      make_date(1990, extract(month from today_a)::int, extract(day from today_a)::int));

  update public.members set notifications_opt_out = true where id = mem_2;
  update public.members set archived_at = now(), archived_reason = 'test' where id = mem_3;

  insert into public.membership_plans (id, org_id, name, plan_type, price_paisa, duration_days, branch_ids)
  values (plan_a, org_a, 'Notif Monthly', 'time', 200000, 30, array[br_a1, br_a2]);

  -- Four members whose plan ends in seven days. Only mem_1 should be texted:
  -- mem_2 opted out, mem_3 is archived, mem_4's number is not deliverable.
  insert into public.memberships (org_id, branch_id, member_id, plan_id, plan_name, plan_type,
                                  start_date, end_date, price_paisa, status)
  select org_a, br_a1, m, plan_a, 'Notif Monthly', 'time',
         today_a - 23, today_a + 7, 200000, 'active'
  from unnest(array[mem_1, mem_2, mem_3, mem_4]) as m;

  ------------------------------------------------- pure helpers: phone numbers
  assert public.normalise_msisdn('9812345678')       = '9812345678', 'bare ten digits';
  assert public.normalise_msisdn('+977 9812-345678') = '9812345678', 'country code and punctuation';
  assert public.normalise_msisdn('009779841000000')  = '9841000000', 'international prefix';
  assert public.normalise_msisdn('01-4567890')       is null,        'a landline is not deliverable';
  assert public.normalise_msisdn('')                 is null,        'blank is not a number';
  assert public.normalise_msisdn(null)               is null,        'null is not a number';

  assert public.format_paisa(200000) = 'Rs 2,000', 'whole rupees print without decimals';
  assert public.format_paisa(123450) = 'Rs 1,234.50', 'paisa print with them';

  ------------------------------------------------------- pure helpers: render
  assert public.render_notification_template(
           'Hi {{member_name}}, {{due_amount}} due.',
           jsonb_build_object('member_name', 'Ram', 'due_amount', 'Rs 500')
         ) = 'Hi Ram, Rs 500 due.', 'placeholders are substituted';
  assert public.render_notification_template(null, '{}'::jsonb) is null,
    'nothing in, nothing out -- a missing subject is null, not empty string';

  -- Every built-in template must be fully satisfied by the variables the
  -- enqueue jobs actually supply. Rendered with that set, no {{placeholder}}
  -- may survive -- an unresolved {{plan_name}} reaching a member is the whole
  -- failure this guards against.
  for s in
    select public.render_notification_template(d.body, jsonb_build_object(
             'member_name', 'Ram Thapa', 'name', 'Ram Thapa',
             'gym_name', 'Nova Fitness', 'branch_name', 'Nova One',
             'plan_name', 'Monthly', 'end_date', '01 Jan 2027',
             'days_left', '7', 'due_amount', 'Rs 2,000',
             'email', 'ram@nova.test'))
    from unnest(array['renewal_reminder','dues_reminder','birthday_greeting']::public.notification_event[]) as e,
         unnest(array['en','ne']) as l,
         lateral public.notification_default_template(e, 'sms'::public.notification_channel, l) d
  loop
    assert s !~ '\{\{', 'a built-in template left a placeholder unresolved: ' || s;
    assert length(s) > 20, 'a built-in template rendered to almost nothing: ' || s;
  end loop;

  ------------------------------------------------ pure helpers: the adapters
  j := public.notification_request('sparrow_sms', '{}'::jsonb, null, 'tok', 'NovaGym', '9812345678', null, 'Hello');
  assert j ->> 'method' = 'GET', 'sparrow goes out as GET: pg_net cannot form-encode a POST';
  assert j ->> 'url' like 'https://%', 'sparrow is called over TLS';
  assert j #>> '{params,token}' = 'tok'  and j #>> '{params,from}' = 'NovaGym'
     and j #>> '{params,to}'    = '9812345678' and j #>> '{params,text}' = 'Hello',
     'sparrow parameter names';

  j := public.notification_request('aakash_sms', '{}'::jsonb, null, 'tok', 'NovaGym', '9812345678', null, 'Hello');
  assert j #>> '{params,auth_token}' = 'tok', 'aakash names its token auth_token';
  assert not (j -> 'params' ? 'from'), 'aakash fixes the sender on the account, so no from';

  j := public.notification_request('viber_business', '{}'::jsonb, null, 'tok', 'NovaGym', 'viber-id', null, 'Hello');
  assert j ->> 'method' = 'POST', 'viber is a JSON POST';
  assert j #>> '{headers,X-Viber-Auth-Token}' = 'tok', 'viber auth header';

  j := public.notification_request('log_only', '{}'::jsonb, null, null, null, '9812345678', null, 'Hello');
  assert j ->> 'method' = 'none', 'log_only issues no request';

  j := public.notification_request(
         'custom_http',
         jsonb_build_object('method','GET','params', jsonb_build_object('k','{{token}}','m','{{text}}')),
         'https://example.test/send', 'tok', 'NovaGym', '9812345678', null, 'Hello');
  assert j #>> '{params,k}' = 'tok' and j #>> '{params,m}' = 'Hello',
    'a custom gateway interpolates its own template';

  ------------------------------------------- pure helpers: reading a verdict
  j := public.notification_response_ok('sparrow_sms', 200, '{"count":1,"response_code":200,"response":"1 queued"}');
  assert (j ->> 'ok')::boolean, 'sparrow success';

  -- Sparrow answers HTTP 200 with an in-body failure code, so status alone lies.
  j := public.notification_response_ok('sparrow_sms', 403, '{"response_code":1013,"response":""}');
  assert not (j ->> 'ok')::boolean, 'sparrow out of credits is not a success';
  assert j ->> 'error' like '%credits%', 'and it says why: ' || coalesce(j ->> 'error', '(null)');

  j := public.notification_response_ok('aakash_sms', 200, '{"error":false,"data":[{"id":"77"}]}');
  assert (j ->> 'ok')::boolean and j ->> 'message_id' = '77', 'aakash success and message id';

  j := public.notification_response_ok('aakash_sms', 200, '{"error":true,"message":"The provided Auth Token is not valid."}');
  assert not (j ->> 'ok')::boolean, 'aakash reports failure inside a 200';

  j := public.notification_response_ok('custom_http', 500, 'Internal Server Error');
  assert not (j ->> 'ok')::boolean, 'a non-JSON 500 is a failure, not a crash';

  j := public.notification_response_ok('custom_http', 200, null);
  assert (j ->> 'ok')::boolean, 'an empty 2xx body is still a success';

  ---------------------------------------------------- persona: org A manager
  -- A manager may read what the gym tells its members, and may not touch the
  -- gateway account.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_manager::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.notification_rules where org_id = org_a;
  assert n = 4, 'a new org is seeded with four default rules, saw ' || n;

  failed := false;
  begin
    insert into public.notification_providers (org_id, channel, provider, sender_id)
    values (org_a, 'sms', 'sparrow_sms', 'NovaGym');
  exception when insufficient_privilege or others then failed := true;
  end;
  assert failed, 'a manager must not be able to configure a gateway';

  failed := false;
  begin
    update public.notification_rules set enabled = false where org_id = org_a;
    if not found then failed := true; end if;
  exception when others then failed := true;
  end;
  assert failed, 'a manager must not be able to change a rule';

  execute 'reset role';

  ------------------------------------------------------ persona: org A owner
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  insert into public.notification_providers (org_id, channel, provider, sender_id)
  values (org_a, 'sms', 'log_only', 'NovaGym')
  returning id into prov_a;

  -- An owner writes a token and can never read it back.
  perform public.set_notification_credential(prov_a, 'nova-secret-token');
  assert public.notification_has_credential(prov_a), 'the console can see that a token is set';

  assert not has_function_privilege('authenticated', 'public.notification_credential(uuid)', 'execute'),
    'the token reader must not be callable by any client role';
  assert not has_function_privilege('authenticated', 'public.send_notification_batch(integer)', 'execute'),
    'the sender is cron-only';
  assert not has_function_privilege('authenticated', 'public.enqueue_notifications()', 'execute'),
    'the sweep is cron-only';

  failed := false;
  begin
    perform s.decrypted_secret from vault.decrypted_secrets s where s.name = 'notif:' || prov_a::text;
    failed := false;
  exception when others then failed := true;
  end;
  assert failed, 'the vault must not be readable by an authenticated caller';

  -- A gateway URL must be TLS: the token travels in the request.
  failed := false;
  begin
    insert into public.notification_providers (org_id, channel, provider, endpoint_url)
    values (org_a, 'viber', 'custom_http', 'http://plaintext.test/send');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a custom gateway over plain http must be refused';

  execute 'reset role';

  --------------------------------------------------------- the enqueue sweep
  -- Run exactly as pg_cron runs it: no request.jwt.claims at all. Guarding the
  -- template resolver on is_org_member() once made this return 0 for every gym
  -- -- reminders stopped silently, which is the worst way this can fail.
  perform set_config('request.jwt.claims', null, true);

  select public.enqueue_renewal_reminders() into n;
  assert n = 2, 'one textable member and one with a bad number, saw ' || n;

  select count(*) into n from public.notification_messages
  where org_id = org_a and event = 'renewal_reminder' and member_id = mem_1 and status = 'queued';
  assert n = 1, 'the expiring member is queued';

  select count(*) into n from public.notification_messages
  where org_id = org_a and member_id = mem_4 and status = 'skipped';
  assert n = 1, 'an undeliverable number is skipped, not failed';

  select count(*) into n from public.notification_messages
  where org_id = org_a and member_id in (mem_2, mem_3);
  assert n = 0, 'an opted-out member and an archived member are never contacted';

  select body into s from public.notification_messages where member_id = mem_1;
  assert s !~ '\{\{', 'the rendered message holds no placeholder: ' || s;
  assert s like '%Expiring Member%' and s like '%Nova Fitness%' and s like '%Notif Monthly%',
    'the message names the member, the gym and the plan: ' || s;

  -- The whole point of the dedupe key.
  select public.enqueue_renewal_reminders() into n;
  assert n = 0, 'a second sweep must text nobody a second time, saw ' || n;

  select public.enqueue_birthday_greetings() into n;
  assert n = 1, 'the birthday member is greeted once, saw ' || n;
  select public.enqueue_birthday_greetings() into n;
  assert n = 0, 'and not again the same day';

  ------------------------------------------------------------- dues cadence
  -- mem_1 can be texted; mem_4's number will never normalise.
  insert into public.invoices (org_id, branch_id, member_id, invoice_no, subtotal_paisa,
                               discount_paisa, total_paisa, paid_paisa, issued_on)
  values (org_a, br_a1, mem_1, 'NOTIF-INV-1', 200000, 0, 200000, 0, today_a - 10),
         (org_a, br_a1, mem_4, 'NOTIF-INV-2', 200000, 0, 200000, 0, today_a - 10);

  select public.enqueue_dues_reminders() into n;
  assert n = 2, 'both ten-day-old debts are picked up, saw ' || n;
  select public.enqueue_dues_reminders() into n;
  assert n = 0, 'and not chased again the same day';

  -- An SMS has no subject. It must hold null, not the empty string: the first
  -- coalesce(subject, ...) written on the email path would otherwise choose ''
  -- over its own fallback.
  select count(*) into n from public.notification_messages
  where org_id = org_a and channel = 'sms' and subject is not null;
  assert n = 0, 'an SMS carries no subject, saw ' || n || ' with one';

  -- The dedupe key carries the date, so tomorrow's sweep is a different key and
  -- only the cadence guard stands between an unreachable member and a `skipped`
  -- row every single night. It did not count `skipped` when this was written.
  update public.notification_messages
     set created_at = created_at - interval '1 day',
         dedupe_key = dedupe_key || ':nextday'
   where org_id = org_a and event = 'dues_reminder';

  select public.enqueue_dues_reminders() into n;
  assert n = 0, 'nobody is chased again the next night, saw ' || n;

  select count(*) into n from public.notification_messages
  where org_id = org_a and event = 'dues_reminder' and member_id = mem_4;
  assert n = 1, 'an unreachable member gets one skipped row, not one a night, saw ' || n;

  ------------------------------------------------------------ read scoping
  select id into msg_1 from public.notification_messages where member_id = mem_1 and event = 'renewal_reminder';
  select id into msg_2 from public.notification_messages where member_id = mem_5;

  -- msg_2 was raised at branch two, which the desk does not cover.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'staff_id', st_a_desk::text,
    'staff_role', 'front_desk', 'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.notification_messages where id = msg_1;
  assert n = 1, 'the desk reads its own branch''s messages';
  select count(*) into n from public.notification_messages where id = msg_2;
  assert n = 0, 'and not another branch''s';

  failed := false;
  begin
    perform public.retry_notification(msg_1);
  exception when others then failed := true;
  end;
  assert failed, 'the desk cannot resend a message';

  execute 'reset role';

  ---------------------------------------------------------- cross-tenant
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_b::text, 'staff_id', st_b_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.notification_messages where org_id = org_a;
  assert n = 0, 'org B reads none of org A''s messages';
  select count(*) into n from public.notification_providers where org_id = org_a;
  assert n = 0, 'org B reads none of org A''s gateways';
  select count(*) into n from public.notification_templates where org_id = org_a;
  assert n = 0, 'org B reads none of org A''s templates';
  select count(*) into n from public.notification_rules where org_id = org_a;
  assert n = 0, 'org B reads none of org A''s rules';

  -- Not just the tables: an RPC that takes an org id must not be a way round
  -- them. The template resolver was SECURITY DEFINER when it was first written
  -- and handed out any org's wording; this is that regression case.
  select count(*) into n
  from public.notification_template_preview(org_a, 'renewal_reminder', 'sms', 'en');
  assert n = 0, 'org B cannot read org A''s wording through the preview RPC';

  assert not has_function_privilege('authenticated',
    'public.resolve_notification_template(uuid, public.notification_event, public.notification_channel, text)',
    'execute'),
    'the sweeps'' own resolver must not be callable by a client role';

  failed := false;
  begin
    perform public.set_notification_credential(prov_a, 'stolen');
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'org B cannot set a token on org A''s gateway';

  assert not public.notification_has_credential(prov_a),
    'org B is not even told whether org A has a token';

  execute 'reset role';

  ------------------------------------------------------------ member scoping
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_a::text, 'member_id', mem_1::text
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.notification_messages;
  assert n >= 1, 'a member reads their own messages';
  select count(*) into n from public.notification_messages where member_id <> mem_1;
  assert n = 0, 'and nobody else''s';
  select count(*) into n from public.notification_providers;
  assert n = 0, 'a member reads no gateway configuration';

  execute 'reset role';

  ------------------------------------------------------- log_only round trip
  -- The gateway is log_only, so this exercises claim, dispatch and completion
  -- with no network at all.
  select public.send_notification_batch(50) into n;
  assert n >= 1, 'the worker dispatched, saw ' || n;

  select count(*) into n from public.notification_messages
  where member_id = mem_1 and status = 'sent' and provider = 'log_only';
  assert n >= 1, 'a log_only send completes without a request';

  select count(*) into n from public.notification_messages where status = 'queued';
  assert n = 0, 'nothing is left queued after a full batch, saw ' || n;

  ------------------------------------------------------------------ teardown
  perform set_config('request.jwt.claims', null, true);
  delete from vault.secrets where name = 'notif:' || prov_a::text;
  delete from public.orgs where id in (org_a, org_b);

  raise notice 'notifications.sql: all assertions passed';
end $$;
