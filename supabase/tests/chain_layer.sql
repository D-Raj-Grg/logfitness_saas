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

-- Task 5 (staff role/branch reassignment): guard_staff_assignment blocks
-- demoting or deactivating the last active owner, a staff member (owner or
-- manager -- RLS otherwise lets both edit their own row) changing their own
-- role, a non-owner ending up with no branches, and a manager reaching past
-- a peer manager. A manager may still edit a front-desk/trainer row they
-- cover, which the last assertion checks does NOT get refused.
do $$
declare
  v_org_a uuid;
  v_branch_1 uuid;
  v_branch_2 uuid;
  v_owner uuid;
  v_mgr1 uuid;
  v_mgr2 uuid;
  v_fd uuid;
  v_failed boolean;
begin
  insert into public.orgs (name, slug, timezone) values ('Gate5 Org A', 'gate5-org-a-test', 'Asia/Kathmandu')
    returning id into v_org_a;

  insert into public.branches (org_id, name) values (v_org_a, 'B1') returning id into v_branch_1;
  insert into public.branches (org_id, name) values (v_org_a, 'B2') returning id into v_branch_2;

  insert into public.staff (org_id, full_name, email, role, branch_ids, status)
  values (v_org_a, 'Gate5 Owner', 'owner@gate5-org-a-test.example', 'owner', '{}', 'active')
  returning id into v_owner;

  insert into public.staff (org_id, full_name, email, role, branch_ids, status)
  values (v_org_a, 'Gate5 Mgr1', 'mgr1@gate5-org-a-test.example', 'manager', array[v_branch_1], 'active')
  returning id into v_mgr1;

  insert into public.staff (org_id, full_name, email, role, branch_ids, status)
  values (v_org_a, 'Gate5 Mgr2', 'mgr2@gate5-org-a-test.example', 'manager', array[v_branch_2], 'active')
  returning id into v_mgr2;

  insert into public.staff (org_id, full_name, email, role, branch_ids, status)
  values (v_org_a, 'Gate5 FrontDesk', 'fd@gate5-org-a-test.example', 'front_desk', array[v_branch_1], 'active')
  returning id into v_fd;

  -- 1. Demoting the only active owner in an org must be refused.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', v_org_a::text, 'staff_id', v_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  v_failed := false;
  begin
    update public.staff set role = 'manager' where id = v_owner;
  exception when others then v_failed := true;
  end;
  execute 'reset role';
  if not v_failed then
    raise exception 'gate5.1: demoting the only active owner should have been refused';
  end if;

  -- 1b. The same guard covers deactivation, not just demotion: the org loses
  --     its only administrator either way.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', v_org_a::text, 'staff_id', v_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  v_failed := false;
  begin
    update public.staff set status = 'inactive' where id = v_owner;
  exception when others then v_failed := true;
  end;
  execute 'reset role';
  if not v_failed then
    raise exception 'gate5.1b: deactivating the only active owner should have been refused';
  end if;

  -- 2. A staff member changing their own role must be refused. RLS permits a
  --    manager to update their own row, so without this the trigger's other
  --    checks would let it through.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', v_org_a::text, 'staff_id', v_mgr1::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(v_branch_1::text)
  )::text, true);
  execute 'set local role authenticated';

  v_failed := false;
  begin
    update public.staff set role = 'front_desk' where id = v_mgr1;
  exception when others then v_failed := true;
  end;
  execute 'reset role';
  if not v_failed then
    raise exception 'gate5.2: a manager changing their own role should have been refused';
  end if;

  -- 3. Setting a non-owner role with an empty branch_ids must be refused.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', v_org_a::text, 'staff_id', v_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  v_failed := false;
  begin
    update public.staff set branch_ids = '{}' where id = v_fd;
  exception when others then v_failed := true;
  end;
  execute 'reset role';
  if not v_failed then
    raise exception 'gate5.3: a non-owner with empty branch_ids should have been refused';
  end if;

  -- 4. A manager reassigning another manager must be refused. RLS's own
  --    check only excludes role = 'owner' from what a manager may touch,
  --    which leaves peer managers exposed without this.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', v_org_a::text, 'staff_id', v_mgr1::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(v_branch_1::text)
  )::text, true);
  execute 'set local role authenticated';

  v_failed := false;
  begin
    update public.staff set branch_ids = array[v_branch_1] where id = v_mgr2;
  exception when others then v_failed := true;
  end;
  execute 'reset role';
  if not v_failed then
    raise exception 'gate5.4: a manager reassigning another manager should have been refused';
  end if;

  -- 5. Negative control: a manager editing a front-desk/trainer row they
  --    cover must still succeed. Without this, a guard broad enough to pass
  --    1-4 could also be broad enough to break ordinary reassignment.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', v_org_a::text, 'staff_id', v_mgr1::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(v_branch_1::text)
  )::text, true);
  execute 'set local role authenticated';

  begin
    update public.staff set role = 'trainer' where id = v_fd;
  exception when others then
    raise exception 'gate5.5: a manager editing a front_desk/trainer row they cover should have succeeded';
  end;
  execute 'reset role';

  perform set_config('request.jwt.claims', null, true);

  delete from public.branches where org_id = v_org_a;
  delete from public.orgs where id = v_org_a;

  raise notice 'chain_layer: staff assignment guard assertions OK';
end $$;

-- Task 6 (/reports/revenue, /reports/membership-movement): revenue_report
-- must agree with daily_collection about the same branch/day, reversals must
-- stay out of refunds_paisa, the branch list must still be a filter and not a
-- permission grant, and a renewal must never be double-counted as new.
do $$
declare
  v_org_a uuid;
  v_org_b uuid;
  v_branch_a1 uuid;
  v_branch_b1 uuid;
  v_owner uuid;
  v_plan_id uuid;
  v_member_id uuid;
  v_payment_id uuid;
  v_res jsonb;
  v_today date;
  v_net_revenue bigint;
  v_net_daily bigint;
  v_reversals_col bigint;
  v_refunds_col bigint;
  v_rows bigint;
  v_new_members bigint;
  v_renewals bigint;
begin
  insert into public.orgs (name, slug, timezone) values ('Gate6 Org A', 'gate6-org-a-test', 'Asia/Kathmandu')
    returning id into v_org_a;
  insert into public.orgs (name, slug, timezone) values ('Gate6 Org B', 'gate6-org-b-test', 'Asia/Kathmandu')
    returning id into v_org_b;

  insert into public.branches (org_id, name) values (v_org_a, 'A1') returning id into v_branch_a1;
  insert into public.branches (org_id, name) values (v_org_b, 'B1') returning id into v_branch_b1;

  insert into public.staff (org_id, full_name, email, role, branch_ids, status)
  values (v_org_a, 'Gate6 Owner', 'owner@gate6-org-a-test.example', 'owner', '{}', 'active')
  returning id into v_owner;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', v_org_a::text, 'staff_id', v_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  insert into public.membership_plans
    (org_id, name, plan_type, duration_days, price_paisa, branch_ids)
  values (v_org_a, 'Gate6 Monthly', 'time', 30, 100000, array[v_branch_a1])
  returning id into v_plan_id;

  -- First membership, sold through register_member. This must land in
  -- new_members, never renewals.
  v_res := public.register_member(
    'Gate6 Member', '9800000001', v_branch_a1,
    p_plan_id => v_plan_id, p_amount_paid_paisa => 100000
  );
  v_member_id := (v_res ->> 'member_id')::uuid;
  v_payment_id := (v_res ->> 'payment_id')::uuid;

  v_today := public.org_today(v_org_a);

  -- 1. revenue_report's net for this branch/day must equal daily_collection's
  --    net for the same branch/day. Two functions disagreeing about one day's
  --    takings is worse than one of them being wrong.
  select coalesce(sum(net_paisa), 0) into v_net_revenue
  from public.revenue_report(array[v_branch_a1], v_today, v_today, 'day');

  select coalesce(sum(amount_paisa), 0) into v_net_daily
  from public.daily_collection(v_today, array[v_branch_a1]);

  if v_net_revenue is distinct from v_net_daily then
    raise exception 'gate6.1: revenue_report net (%) <> daily_collection net (%)',
      v_net_revenue, v_net_daily;
  end if;

  -- 2. Reversing part of that payment must show up in reversals_paisa, never
  --    refunds_paisa. A refund says cash left the drawer; a reversal says a
  --    note that was rung up never arrived.
  perform public.reverse_payment(v_payment_id, 'gate6 test reversal', 20000);

  select coalesce(sum(reversals_paisa), 0), coalesce(sum(refunds_paisa), 0)
    into v_reversals_col, v_refunds_col
  from public.revenue_report(array[v_branch_a1], v_today, v_today, 'day');

  if v_reversals_col <> 20000 then
    raise exception 'gate6.2: reversals_paisa should be 20000, got %', v_reversals_col;
  end if;
  if v_refunds_col <> 0 then
    raise exception 'gate6.2: refunds_paisa should be 0, got %', v_refunds_col;
  end if;

  -- Net must still reconcile with daily_collection after the reversal.
  select coalesce(sum(net_paisa), 0) into v_net_revenue
  from public.revenue_report(array[v_branch_a1], v_today, v_today, 'day');
  select coalesce(sum(amount_paisa), 0) into v_net_daily
  from public.daily_collection(v_today, array[v_branch_a1]);
  if v_net_revenue is distinct from v_net_daily then
    raise exception 'gate6.2b: revenue_report net (%) <> daily_collection net (%) after reversal',
      v_net_revenue, v_net_daily;
  end if;

  -- 3. Org A's owner asking for Org B's branch gets zero rows. The branch
  --    list is a filter on top of RLS, never a permission grant beyond it.
  select count(*) into v_rows
  from public.revenue_report(array[v_branch_b1], null, null, 'day');
  if v_rows <> 0 then
    raise exception 'gate6.3: revenue_report on another org''s branch should return zero rows, got %', v_rows;
  end if;

  -- 4. A second membership for the same member is a renewal, never counted as
  --    new again. Append-only history is what makes "first" answerable at all.
  perform public.renew_membership(v_member_id, v_plan_id, v_branch_a1, v_today);

  select coalesce(sum(new_members), 0), coalesce(sum(renewals), 0)
    into v_new_members, v_renewals
  from public.membership_movement(array[v_branch_a1], v_today - 365, v_today, 'month');

  if v_new_members <> 1 then
    raise exception 'gate6.4: expected exactly 1 new_members, got %', v_new_members;
  end if;
  if v_renewals <> 1 then
    raise exception 'gate6.4: expected exactly 1 renewal, got %', v_renewals;
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  delete from public.branches where org_id in (v_org_a, v_org_b);
  delete from public.orgs where id in (v_org_a, v_org_b);

  raise notice 'chain_layer: revenue_report and membership_movement assertions OK';
end $$;

-- Task 5 follow-up (review finding): guard_staff_assignment's manager
-- ceiling must mirror "owners and managers invite staff" exactly -- a
-- manager may only ever leave a covered row as front_desk or trainer, so
-- promoting one into a peer manager is refused exactly like reaching an
-- existing peer already was. A manager editing that same row's branches
-- (no role change) must still succeed.
do $$
declare
  v_org_a uuid;
  v_branch_1 uuid;
  v_branch_2 uuid;
  v_owner uuid;
  v_mgr1 uuid;
  v_fd uuid;
  v_failed boolean;
begin
  insert into public.orgs (name, slug, timezone) values ('Gate5b Org A', 'gate5b-org-a-test', 'Asia/Kathmandu')
    returning id into v_org_a;

  insert into public.branches (org_id, name) values (v_org_a, 'B1') returning id into v_branch_1;
  insert into public.branches (org_id, name) values (v_org_a, 'B2') returning id into v_branch_2;

  insert into public.staff (org_id, full_name, email, role, branch_ids, status)
  values (v_org_a, 'Gate5b Owner', 'owner@gate5b-org-a-test.example', 'owner', '{}', 'active')
  returning id into v_owner;

  insert into public.staff (org_id, full_name, email, role, branch_ids, status)
  values (v_org_a, 'Gate5b Mgr1', 'mgr1@gate5b-org-a-test.example', 'manager', array[v_branch_1], 'active')
  returning id into v_mgr1;

  insert into public.staff (org_id, full_name, email, role, branch_ids, status)
  values (v_org_a, 'Gate5b FrontDesk', 'fd@gate5b-org-a-test.example', 'front_desk', array[v_branch_1], 'active')
  returning id into v_fd;

  -- 1. A manager promoting a covered front_desk to manager must be refused.
  --    This is the escalation the RLS WITH CHECK alone does not stop:
  --    manager's only role ceiling there is role <> 'owner'.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', v_org_a::text, 'staff_id', v_mgr1::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(v_branch_1::text)
  )::text, true);
  execute 'set local role authenticated';

  v_failed := false;
  begin
    update public.staff set role = 'manager' where id = v_fd;
  exception when others then v_failed := true;
  end;
  execute 'reset role';
  if not v_failed then
    raise exception 'gate5b.1: a manager promoting a covered front_desk to manager should have been refused';
  end if;

  -- 2. Editing that same front_desk's branches (no role change) must still
  --    succeed -- the ceiling fix must not collaterally break ordinary
  --    reassignment.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', v_org_a::text, 'staff_id', v_mgr1::text,
    'staff_role', 'manager', 'branch_ids', json_build_array(v_branch_1::text)
  )::text, true);
  execute 'set local role authenticated';

  begin
    update public.staff set branch_ids = array[v_branch_1] where id = v_fd;
  exception when others then
    raise exception 'gate5b.2: a manager editing a covered front_desk''s branches should have succeeded';
  end;
  execute 'reset role';

  perform set_config('request.jwt.claims', null, true);

  delete from public.branches where org_id = v_org_a;
  delete from public.orgs where id = v_org_a;

  raise notice 'chain_layer: staff assignment manager-ceiling assertions OK';
end $$;

-- Task 7 (/reports/attendance, /reports/plan-mix): attendance_trend's
-- check-in counts must agree with attendance_day_summary for the same
-- branch/day, distinct_members must never exceed check_ins, plan_mix's
-- share_pct over a scope must sum to 100 (within rounding) and must not
-- divide by zero when the scope has no active memberships, and the branch
-- list must still be a filter and not a permission grant for both.
do $$
declare
  v_org_a uuid;
  v_org_b uuid;
  v_branch_a1 uuid;
  v_branch_a2 uuid;
  v_branch_b1 uuid;
  v_owner uuid;
  v_plan_month uuid;
  v_plan_year uuid;
  v_res jsonb;
  v_member1 uuid;
  v_member2 uuid;
  v_member3 uuid;
  v_today date;
  v_check_ins_trend bigint;
  v_distinct_trend bigint;
  v_check_ins_summary bigint;
  v_distinct_summary bigint;
  v_rows bigint;
  v_sum_share numeric;
  v_active_month bigint;
  v_active_year bigint;
  rec record;
begin
  insert into public.orgs (name, slug, timezone) values ('Gate7 Org A', 'gate7-org-a-test', 'Asia/Kathmandu')
    returning id into v_org_a;
  insert into public.orgs (name, slug, timezone) values ('Gate7 Org B', 'gate7-org-b-test', 'Asia/Kathmandu')
    returning id into v_org_b;

  insert into public.branches (org_id, name) values (v_org_a, 'A1') returning id into v_branch_a1;
  insert into public.branches (org_id, name) values (v_org_a, 'A2') returning id into v_branch_a2;
  insert into public.branches (org_id, name) values (v_org_b, 'B1') returning id into v_branch_b1;

  insert into public.staff (org_id, full_name, email, role, branch_ids, status)
  values (v_org_a, 'Gate7 Owner', 'owner@gate7-org-a-test.example', 'owner', '{}', 'active')
  returning id into v_owner;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', v_org_a::text, 'staff_id', v_owner::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  insert into public.membership_plans
    (org_id, name, plan_type, duration_days, price_paisa, branch_ids)
  values (v_org_a, 'Gate7 Monthly', 'time', 30, 100000, array[v_branch_a1])
  returning id into v_plan_month;

  insert into public.membership_plans
    (org_id, name, plan_type, duration_days, price_paisa, branch_ids)
  values (v_org_a, 'Gate7 Yearly', 'time', 365, 900000, array[v_branch_a1])
  returning id into v_plan_year;

  -- Two active memberships on the monthly plan, one on the yearly plan.
  v_res := public.register_member(
    'Gate7 Member One', '9800000101', v_branch_a1,
    p_plan_id => v_plan_month, p_amount_paid_paisa => 100000
  );
  v_member1 := (v_res ->> 'member_id')::uuid;

  v_res := public.register_member(
    'Gate7 Member Two', '9800000102', v_branch_a1,
    p_plan_id => v_plan_month, p_amount_paid_paisa => 100000
  );
  v_member2 := (v_res ->> 'member_id')::uuid;

  v_res := public.register_member(
    'Gate7 Member Three', '9800000103', v_branch_a1,
    p_plan_id => v_plan_year, p_amount_paid_paisa => 900000
  );
  v_member3 := (v_res ->> 'member_id')::uuid;

  v_today := public.org_today(v_org_a);

  -- Attendance: member1 checks in today and yesterday (two rows, one
  -- person -- check_ins must exceed distinct_members for that member's
  -- span). member2 checks in today only, alongside member1.
  --
  -- attended_on is derived by the prepare_attendance_row trigger from
  -- checked_in_at (never trusted from the caller), so the "yesterday" row
  -- must set checked_in_at explicitly rather than attended_on.
  insert into public.attendance (org_id, branch_id, member_id, checked_in_by)
  values (v_org_a, v_branch_a1, v_member1, v_owner);
  insert into public.attendance (org_id, branch_id, member_id, checked_in_by, checked_in_at)
  values (
    v_org_a, v_branch_a1, v_member1, v_owner,
    (v_today - 1 + time '12:00')::timestamp at time zone 'Asia/Kathmandu'
  );
  insert into public.attendance (org_id, branch_id, member_id, checked_in_by)
  values (v_org_a, v_branch_a1, v_member2, v_owner);

  -- 1. attendance_trend for a single day/branch must agree with
  --    attendance_day_summary for the same day/branch.
  select coalesce(sum(check_ins), 0), coalesce(sum(distinct_members), 0)
    into v_check_ins_trend, v_distinct_trend
  from public.attendance_trend(array[v_branch_a1], v_today, v_today, 'day');

  select coalesce(sum(check_ins), 0), coalesce(sum(distinct_members), 0)
    into v_check_ins_summary, v_distinct_summary
  from public.attendance_day_summary(v_today, array[v_branch_a1]);

  if v_check_ins_trend is distinct from v_check_ins_summary then
    raise exception 'gate7.1: attendance_trend check_ins (%) <> attendance_day_summary (%)',
      v_check_ins_trend, v_check_ins_summary;
  end if;
  if v_distinct_trend is distinct from v_distinct_summary then
    raise exception 'gate7.1: attendance_trend distinct_members (%) <> attendance_day_summary (%)',
      v_distinct_trend, v_distinct_summary;
  end if;
  if v_check_ins_trend <> 2 or v_distinct_trend <> 2 then
    raise exception 'gate7.1: expected 2 check_ins and 2 distinct_members today, got % / %',
      v_check_ins_trend, v_distinct_trend;
  end if;

  -- 2. distinct_members must never exceed check_ins, per row. Over the two
  --    days member1 alone produced 2 check_ins but is still 1 distinct
  --    member -- assert that at the row level for every row returned.
  for rec in
    select * from public.attendance_trend(array[v_branch_a1], v_today - 1, v_today, 'month')
  loop
    if rec.distinct_members > rec.check_ins then
      raise exception 'gate7.2: distinct_members (%) > check_ins (%) for period %',
        rec.distinct_members, rec.check_ins, rec.period;
    end if;
  end loop;

  select check_ins, distinct_members into v_check_ins_trend, v_distinct_trend
  from public.attendance_trend(array[v_branch_a1], v_today - 1, v_today, 'month');

  if v_check_ins_trend <> 3 then
    raise exception 'gate7.2: expected 3 check_ins across the two days, got %', v_check_ins_trend;
  end if;
  if v_distinct_trend <> 2 then
    raise exception 'gate7.2: expected 2 distinct_members across the two days, got %', v_distinct_trend;
  end if;

  -- 3. plan_mix share_pct over a scope with active memberships sums to 100
  --    (within rounding): 2 of 3 active memberships on the monthly plan,
  --    1 of 3 on the yearly plan.
  select coalesce(sum(share_pct), 0) into v_sum_share
  from public.plan_mix(array[v_branch_a1]);

  if abs(v_sum_share - 100.0) > 0.2 then
    raise exception 'gate7.3: plan_mix share_pct should sum to ~100, got %', v_sum_share;
  end if;

  select active_memberships into v_active_month
  from public.plan_mix(array[v_branch_a1]) where plan_id = v_plan_month;
  select active_memberships into v_active_year
  from public.plan_mix(array[v_branch_a1]) where plan_id = v_plan_year;

  if v_active_month <> 2 then
    raise exception 'gate7.3: expected 2 active memberships on the monthly plan, got %', v_active_month;
  end if;
  if v_active_year <> 1 then
    raise exception 'gate7.3: expected 1 active membership on the yearly plan, got %', v_active_year;
  end if;

  -- 4. plan_mix on a scope with no active memberships returns zero rows,
  --    not a division-by-zero error.
  select count(*) into v_rows from public.plan_mix(array[v_branch_a2]);
  if v_rows <> 0 then
    raise exception 'gate7.4: plan_mix on an empty scope should return zero rows, got %', v_rows;
  end if;

  -- 5. The branch list is a filter, never a permission grant: org A's owner
  --    asking for org B's branch gets zero rows from both functions.
  select count(*) into v_rows
  from public.attendance_trend(array[v_branch_b1], null, null, 'day');
  if v_rows <> 0 then
    raise exception 'gate7.5: attendance_trend on another org''s branch should return zero rows, got %', v_rows;
  end if;

  select count(*) into v_rows from public.plan_mix(array[v_branch_b1]);
  if v_rows <> 0 then
    raise exception 'gate7.5: plan_mix on another org''s branch should return zero rows, got %', v_rows;
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  delete from public.branches where org_id in (v_org_a, v_org_b);
  delete from public.orgs where id in (v_org_a, v_org_b);

  raise notice 'chain_layer: attendance_trend and plan_mix assertions OK';
end $$;
