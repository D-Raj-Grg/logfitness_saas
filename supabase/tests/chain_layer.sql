-- supabase/tests/chain_layer.sql
-- Phase 3 gate: branch-list scoping, org_snapshot, the chain reports, and the
-- staff reassignment guards. Run through the Supabase MCP by wrapping the body
-- in a throwaway function (see docs/superpowers/plans/2026-09-07-phase-3-chain-layer.md).
do $$
declare
  v_org_a uuid;
  v_org_b uuid;
  v_branch_a1 uuid;
  v_branch_a2 uuid;
  v_branch_b1 uuid;
  v_rows bigint;
begin
  -- Fixtures: two orgs so every read has something it must NOT see.
  insert into public.orgs (name, slug, timezone) values ('Gate Org A', 'gate-org-a-test', 'Asia/Kathmandu')
    returning id into v_org_a;
  insert into public.orgs (name, slug, timezone) values ('Gate Org B', 'gate-org-b-test', 'Asia/Kathmandu')
    returning id into v_org_b;

  insert into public.branches (org_id, name) values (v_org_a, 'A1') returning id into v_branch_a1;
  insert into public.branches (org_id, name) values (v_org_a, 'A2') returning id into v_branch_a2;
  insert into public.branches (org_id, name) values (v_org_b, 'B1') returning id into v_branch_b1;

  -- 1. A branch list of two branches runs without error (the array signature
  --    exists). No attendance yet, so the row-level assertions land in Task 3
  --    once org_snapshot has data.
  perform public.attendance_day_summary(null, array[v_branch_a1, v_branch_a2]);

  -- 2. An empty array means "no branches", not "all branches". This is the
  --    difference that stops a scope bug from silently widening a report.
  select count(*) into v_rows
  from public.attendance_day_summary(null, array[]::uuid[]);
  if v_rows <> 0 then
    raise exception 'empty branch list must return no rows, got %', v_rows;
  end if;

  -- 3. Null still means "every branch RLS allows".
  perform public.arrears_report(null);
  perform public.in_gym_now(null);
  perform public.absent_members(null, 14);
  perform public.daily_collection(null, null);

  raise notice 'chain_layer: branch-list signatures OK';

  -- org_snapshot: the totals row is the sum of the branch rows. If these ever
  -- disagree, the tiles and the table on the same screen contradict each other.
  declare
    v_total_active bigint;
    v_sum_active bigint;
  begin
    select active_members into v_total_active
    from public.org_snapshot(null) where branch_id is null;

    select coalesce(sum(active_members), 0) into v_sum_active
    from public.org_snapshot(null) where branch_id is not null;

    if v_total_active is distinct from v_sum_active then
      raise exception 'org_snapshot totals (%) <> sum of branches (%)',
        v_total_active, v_sum_active;
    end if;
  end;

  -- An archived member is not an active member.
  -- (Fixture: one active member at A1, then archive them.)
  declare
    v_staff_owner uuid;
    v_plan_id uuid;
    v_member_id uuid;
    v_res jsonb;
    v_before bigint;
    v_after bigint;
  begin
    insert into public.staff (org_id, full_name, email, role, branch_ids, status)
    values (v_org_a, 'Gate Owner', 'owner@gate-org-a-test.example', 'owner', '{}', 'active')
    returning id into v_staff_owner;

    perform set_config('request.jwt.claims', json_build_object(
      'sub', gen_random_uuid()::text, 'role', 'authenticated',
      'org_id', v_org_a::text, 'staff_id', v_staff_owner::text,
      'staff_role', 'owner', 'branch_ids', json_build_array()
    )::text, true);
    execute 'set local role authenticated';

    -- A plan and a paid-in-full sale, so the member's derived status comes
    -- out 'active' and org_snapshot has something to count.
    insert into public.membership_plans
      (org_id, name, plan_type, duration_days, price_paisa, branch_ids)
    values (v_org_a, 'Gate Monthly', 'time', 30, 100000, array[v_branch_a1])
    returning id into v_plan_id;

    v_res := public.register_member(
      'Gate Member', '9800000000', v_branch_a1,
      p_plan_id => v_plan_id, p_amount_paid_paisa => 100000
    );
    v_member_id := (v_res ->> 'member_id')::uuid;

    select active_members into v_before
    from public.org_snapshot(array[v_branch_a1]) where branch_id = v_branch_a1;

    perform public.archive_member(v_member_id, 'gate test cleanup');

    select active_members into v_after
    from public.org_snapshot(array[v_branch_a1]) where branch_id = v_branch_a1;

    execute 'reset role';
    perform set_config('request.jwt.claims', null, true);

    if v_after is distinct from (v_before - 1) then
      raise exception 'archiving a member left active_members at % (was %)',
        v_after, v_before;
    end if;
  end;

  raise notice 'chain_layer: org_snapshot assertions OK';

  delete from public.branches where org_id in (v_org_a, v_org_b);
  delete from public.orgs where id in (v_org_a, v_org_b);
end $$;

-- Task 4 (/branches): an owner can create and edit branches in their own org
-- only, a manager cannot create one at all, and nobody can delete one -- the
-- policy was dropped in 20260908100200_branch_write_policies.sql, so this now
-- falls back to RLS default-deny.
do $$
declare
  v_org_a uuid;
  v_org_b uuid;
  v_staff_a_owner uuid;
  v_staff_a_mgr uuid;
  v_branch_a1 uuid;
  v_failed boolean;
  v_n bigint;
begin
  insert into public.orgs (name, slug, timezone) values ('Gate4 Org A', 'gate4-org-a-test', 'Asia/Kathmandu')
    returning id into v_org_a;
  insert into public.orgs (name, slug, timezone) values ('Gate4 Org B', 'gate4-org-b-test', 'Asia/Kathmandu')
    returning id into v_org_b;

  insert into public.branches (org_id, name) values (v_org_a, 'A1') returning id into v_branch_a1;

  insert into public.staff (org_id, full_name, email, role, branch_ids, status)
  values (v_org_a, 'Gate4 Owner', 'owner@gate4-org-a-test.example', 'owner', '{}', 'active')
  returning id into v_staff_a_owner;

  insert into public.staff (org_id, full_name, email, role, branch_ids, status)
  values (v_org_a, 'Gate4 Manager', 'mgr@gate4-org-a-test.example', 'manager', array[v_branch_a1], 'active')
  returning id into v_staff_a_mgr;

  -- persona: org A owner, trying to insert a branch into org B
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', v_org_a::text, 'staff_id', v_staff_a_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  v_failed := false;
  begin
    insert into public.branches (org_id, name) values (v_org_b, 'Cross Org Branch');
  exception when insufficient_privilege or check_violation then v_failed := true;
  end;
  if not v_failed then
    raise exception 'org A owner was able to insert a branch into org B';
  end if;

  -- an owner still cannot delete a branch -- there is no delete policy at all
  v_failed := false;
  begin
    delete from public.branches where id = v_branch_a1;
  exception when insufficient_privilege then v_failed := true;
  end;
  select count(*) into v_n from public.branches where id = v_branch_a1;
  if v_n <> 1 then
    raise exception 'org A owner deleted a branch (no delete policy should exist)';
  end if;

  execute 'reset role';

  -- persona: org A manager, trying to insert a branch into their own org
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', v_org_a::text, 'staff_id', v_staff_a_mgr::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(v_branch_a1::text)
  )::text, true);
  execute 'set local role authenticated';

  v_failed := false;
  begin
    insert into public.branches (org_id, name) values (v_org_a, 'Manager Branch');
  exception when insufficient_privilege or check_violation then v_failed := true;
  end;
  if not v_failed then
    raise exception 'org A manager was able to insert a branch';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  -- org_id fkey on staff cascades from orgs, so deleting the orgs tears down
  -- their staff and branches in one step without tripping the last-owner guard.
  delete from public.orgs where id in (v_org_a, v_org_b);

  raise notice 'chain_layer: branch write policy assertions OK';
end $$;
