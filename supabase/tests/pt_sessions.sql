-- Phase 4 gate: pt_sessions isolation and the PT RPCs. Written, NOT yet run.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pt_sessions.sql
--
-- Everything runs in one transaction that is rolled back at the end.

begin;

do $$
declare
  org_a uuid := '77777777-7777-7777-7777-777777777771';
  org_b uuid := '77777777-7777-7777-7777-777777777772';
  br_a uuid := '77777777-0000-0000-0000-0000000000a1';
  br_b uuid := '77777777-0000-0000-0000-0000000000b1';
  st_a_owner uuid := '77777777-0000-0000-0000-00000000a00f';
  st_a_trainer uuid := '77777777-0000-0000-0000-00000000a00a';
  st_a_trainer2 uuid := '77777777-0000-0000-0000-00000000a00b';
  st_b_owner uuid := '77777777-0000-0000-0000-00000000b00f';
  plan_pack uuid;
  member_a uuid;
  member_b uuid;
  ms_pack uuid;
  pt1 uuid;
  pt_b uuid;
  res jsonb;
  n integer;
  failed boolean;
  today_a date;
begin
  insert into public.orgs (id, name, slug) values
    (org_a, 'Eta Fitness', 'eta-fitness-test'), (org_b, 'Theta Gyms', 'theta-gyms-test');
  insert into public.branches (id, org_id, name) values (br_a, org_a, 'Eta'), (br_b, org_b, 'Theta');
  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status) values
    (st_a_owner, org_a, 'Eta Owner', 'owner@eta.test', 'owner', '{}', 'active'),
    (st_a_trainer, org_a, 'Eta Trainer', 'trainer@eta.test', 'trainer', array[br_a], 'active'),
    (st_a_trainer2, org_a, 'Eta Trainer 2', 'trainer2@eta.test', 'trainer', array[br_a], 'active'),
    (st_b_owner, org_b, 'Theta Owner', 'owner@theta.test', 'owner', '{}', 'active');
  today_a := public.org_today(org_a);

  insert into public.membership_plans (org_id, name, plan_type, price_paisa, sessions_total)
  values (org_a, 'PT 2-pack', 'session_pack', 500000, 2) returning id into plan_pack;

  insert into public.members (org_id, home_branch_id, full_name, phone)
  values (org_a, br_a, 'Pt Member', '9830000001') returning id into member_a;
  insert into public.members (org_id, home_branch_id, full_name, phone)
  values (org_b, br_b, 'Theta Member', '9830000002') returning id into member_b;

  insert into public.memberships
    (org_id, branch_id, member_id, plan_id, plan_name, plan_type, start_date, end_date,
     sessions_total, sessions_remaining, price_paisa, status)
  values (org_a, br_a, member_a, plan_pack, 'PT 2-pack', 'session_pack', today_a, today_a + 60, 2, 2, 500000, 'active')
  returning id into ms_pack;

  insert into public.pt_sessions (org_id, branch_id, trainer_id, member_id, scheduled_at)
  values (org_b, br_b, st_b_owner, member_b, now() + interval '1 day') returning id into pt_b;

  -- owner of org A: books, sees only org A rows ------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated', 'org_id', org_a,
    'staff_id', st_a_owner, 'staff_role', 'owner', 'is_staff', true,
    'branch_ids', '[]'::jsonb)::text, true);
  execute 'set local role authenticated';

  res := public.book_pt_session(member_a, st_a_trainer, now() + interval '1 day', 60);
  pt1 := (res ->> 'pt_session_id')::uuid;

  select count(*) into n from public.pt_sessions where id = pt_b;
  if n <> 0 then raise exception 'FAIL: org A can read org B pt_sessions'; end if;

  -- overlapping booking for the same trainer is refused
  failed := false;
  begin
    perform public.book_pt_session(member_a, st_a_trainer, now() + interval '1 day' + interval '30 minutes', 60);
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: trainer double-booked'; end if;

  -- cross-tenant RPC use is refused
  failed := false;
  begin perform public.complete_pt_session(pt_b);
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: org A completed an org B session'; end if;

  failed := false;
  begin perform public.book_pt_session(member_b, st_b_owner, now() + interval '2 day', 60);
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: org A booked an org B member'; end if;

  -- direct writes are not possible (no policy)
  failed := false;
  begin
    update public.pt_sessions set status = 'completed', completed_at = now() where id = pt1;
    get diagnostics n = row_count;
    if n = 0 then failed := true; end if;
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: direct update of pt_sessions allowed'; end if;

  -- a different trainer cannot complete someone else's session ----------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated', 'org_id', org_a,
    'staff_id', st_a_trainer2, 'staff_role', 'trainer', 'is_staff', true,
    'branch_ids', jsonb_build_array(br_a))::text, true);
  failed := false;
  begin perform public.complete_pt_session(pt1);
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: other trainer completed the session'; end if;

  -- the assigned trainer completes it; the pack drops 2 -> 1 ------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated', 'org_id', org_a,
    'staff_id', st_a_trainer, 'staff_role', 'trainer', 'is_staff', true,
    'branch_ids', jsonb_build_array(br_a))::text, true);
  res := public.complete_pt_session(pt1);
  if (res ->> 'sessions_remaining')::int <> 1 then raise exception 'FAIL: pack not decremented'; end if;

  failed := false;
  begin perform public.complete_pt_session(pt1);
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: completed twice'; end if;

  -- drain the pack, then completion is refused at 0 ---------------------------
  execute 'reset role';
  update public.memberships set sessions_remaining = 0 where id = ms_pack;
  insert into public.pt_sessions (org_id, branch_id, trainer_id, member_id, membership_id, scheduled_at)
  values (org_a, br_a, st_a_trainer, member_a, ms_pack, now() + interval '3 day') returning id into pt1;
  execute 'set local role authenticated';

  failed := false;
  begin perform public.complete_pt_session(pt1);
  exception when others then failed := true; end;
  if not failed then raise exception 'FAIL: completed with no sessions left'; end if;

  -- org B owner cannot see org A rows ---------------------------------------
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated', 'org_id', org_b,
    'staff_id', st_b_owner, 'staff_role', 'owner', 'is_staff', true,
    'branch_ids', '[]'::jsonb)::text, true);
  select count(*) into n from public.pt_sessions where org_id = org_a;
  if n <> 0 then raise exception 'FAIL: org B can read org A pt_sessions'; end if;

  raise notice 'pt_sessions: all checks passed';
end;
$$;

rollback;
