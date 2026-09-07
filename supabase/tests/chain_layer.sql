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

  delete from public.branches where org_id in (v_org_a, v_org_b);
  delete from public.orgs where id in (v_org_a, v_org_b);
end $$;
