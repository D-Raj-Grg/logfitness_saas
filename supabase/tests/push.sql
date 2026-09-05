-- Phase 6 gate: push notification substrate RLS negatives.
--
-- Seeds one org, two members, and a staff owner, drives register/revoke as
-- real personas, and asserts:
--   1. a member cannot read another member's device tokens
--   2. staff (even an owner) cannot read a member's device tokens
--   3. a revoked token stops appearing in the fanout's live-token query
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/push.sql

do $$
declare
  org_a uuid := '55555555-5555-5555-5555-555555555555';
  br_a1 uuid := 'eeeeeee1-0000-0000-0000-000000000001';
  st_owner uuid := 'e0000000-0000-0000-0000-00000000000f';
  member_1 uuid;
  member_2 uuid;
  tok1_id uuid;
  tok2_id uuid;
  n integer;
  failed boolean;
begin
  -- fixtures, as the owning role so RLS is out of the way -------------------
  insert into public.orgs (id, name, slug) values
    (org_a, 'Epsilon Fitness', 'epsilon-fitness-test');

  insert into public.branches (id, org_id, name) values
    (br_a1, org_a, 'Epsilon Main');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_owner, org_a, 'Epsilon Owner', 'owner@epsilon.test', 'owner', '{}', 'active');

  insert into public.members (org_id, home_branch_id, full_name, phone, status)
  values
    (org_a, br_a1, 'Member One', '9800000001', 'active')
  returning id into member_1;

  insert into public.members (org_id, home_branch_id, full_name, phone, status)
  values
    (org_a, br_a1, 'Member Two', '9800000002', 'active')
  returning id into member_2;

  -- persona: member 1 registers a device token -------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'member',
    'org_id', org_a::text, 'member_id', member_1::text,
    'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  tok1_id := public.register_device_token('tok-member-1-device-a', 'android', '1.0.0');

  select id into tok1_id from public.device_tokens where token = 'tok-member-1-device-a';
  assert tok1_id is not null, 'member 1 token was not created';

  select count(*) into n from public.device_tokens;
  assert n = 1, 'member 1 should see exactly their own token, saw %', n;

  -- Registering the same token again is idempotent -- no duplicate row.
  perform public.register_device_token('tok-member-1-device-a', 'android', '1.0.1');
  select count(*) into n from public.device_tokens where token = 'tok-member-1-device-a';
  assert n = 1, 're-registering the same token duplicated the row';

  execute 'reset role';

  -- persona: member 2 registers their own token, then tries to read member 1's -
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'member',
    'org_id', org_a::text, 'member_id', member_2::text,
    'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  tok2_id := public.register_device_token('tok-member-2-device-a', 'ios', '2.0.0');

  -- Negative 1: a member cannot read another member's device tokens.
  select count(*) into n from public.device_tokens where member_id = member_1;
  assert n = 0, 'member 2 could read member 1''s device token via RLS';

  select count(*) into n from public.device_tokens;
  assert n = 1, 'member 2 should see exactly their own token, saw %', n;

  -- A device that gets handed to member 2 must move, not duplicate: re-point
  -- member 1's token to member 2 by registering it as member 2.
  perform public.register_device_token('tok-member-1-device-a', 'android', '1.1.0');

  select count(*) into n from public.device_tokens;
  assert n = 2, 're-pointing a token should not change the row count, saw %', n;

  execute 'reset role';

  -- Negative 2: staff -- even an owner -- cannot read a member's device tokens.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'owner',
    'org_id', org_a::text, 'staff_id', st_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  select count(*) into n from public.device_tokens;
  assert n = 0, 'staff owner could read member device tokens via RLS, saw %', n;

  -- Staff registering their own device token is a separate, legitimate path,
  -- and staff should see only that row -- never a member's.
  perform public.register_device_token('tok-staff-owner-device-a', 'ios', '3.0.0');
  select count(*) into n from public.device_tokens;
  assert n = 1, 'staff should see exactly their own device token, saw %', n;

  execute 'reset role';

  -- persona: member 2 revokes the token that got re-pointed to them ----------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'member',
    'org_id', org_a::text, 'member_id', member_2::text,
    'branch_ids', json_build_array(br_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  perform public.revoke_device_token('tok-member-1-device-a');

  -- Revoking an already-revoked token, or someone else's token, is refused
  -- (the two cases are indistinguishable by design).
  failed := false;
  begin
    perform public.revoke_device_token('tok-member-1-device-a');
  exception when no_data_found then failed := true;
  end;
  assert failed, 'revoking an already-revoked token should fail, not succeed silently';

  failed := false;
  begin
    perform public.revoke_device_token('tok-staff-owner-device-a');
  exception when no_data_found then failed := true;
  end;
  assert failed, 'member 2 revoked staff''s device token -- should be impossible';

  execute 'reset role';

  -- Negative 3: a revoked token stops appearing in the fanout's live-token
  -- query. This is the exact predicate push-fanout uses (token / org /
  -- revoked_at is null), run with RLS bypassed -- matching how the Edge
  -- Function reads with the service-role key.
  select count(*) into n
  from public.device_tokens
  where token = 'tok-member-1-device-a'
    and revoked_at is null;
  assert n = 0, 'revoked token still appeared in the live-token fanout query';

  select count(*) into n
  from public.device_tokens
  where org_id = org_a
    and revoked_at is null;
  assert n = 2, 'expected member 2''s original token + staff''s token to remain live, saw %', n;

  raise notice 'push.sql: all assertions passed';

  -- teardown ------------------------------------------------------------------
  -- Delete the org first: the last-active-owner guard trigger on public.staff
  -- exempts a delete once its org row is already gone, and every child table
  -- here cascades on org_id, so this alone clears staff/members/device_tokens.
  delete from public.push_log where org_id = org_a;
  delete from public.orgs where id = org_a;
end;
$$;
