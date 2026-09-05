-- Demo tenant for local development.
--
--   psql "$SUPABASE_DB_URL" -f supabase/seed.sql
--
-- Staff rows are created in the 'invited' state with no auth user attached. To
-- sign in as one of them, register at /signup with that email address: the app
-- calls link_staff_account() on first load and adopts the waiting row.
--
-- Never run this against production. It writes fixed UUIDs so it is safe to
-- re-run, and safe to delete with the statement at the bottom.

insert into public.orgs (id, name, slug, max_branches)
values (
  '00000000-0000-4000-8000-000000000001',
  'Everest Fitness',
  'everest-fitness-demo',
  10
)
on conflict (id) do nothing;

insert into public.branches (id, org_id, name, address, phone, opens_at, closes_at)
values
  ('00000000-0000-4000-8000-000000000101',
   '00000000-0000-4000-8000-000000000001',
   'Thamel', 'Thamel Marg, Kathmandu', '+977-1-4000001', '05:00', '22:00'),
  ('00000000-0000-4000-8000-000000000102',
   '00000000-0000-4000-8000-000000000001',
   'Patan', 'Pulchowk, Lalitpur', '+977-1-4000002', '05:00', '22:00'),
  ('00000000-0000-4000-8000-000000000103',
   '00000000-0000-4000-8000-000000000001',
   'Baneshwor', 'New Baneshwor, Kathmandu', '+977-1-4000003', '06:00', '21:00')
on conflict (id) do nothing;

insert into public.staff (id, org_id, full_name, email, phone, role, branch_ids, status)
values
  ('00000000-0000-4000-8000-000000000201',
   '00000000-0000-4000-8000-000000000001',
   'Demo Owner', 'owner@everest.test', '+977-98-0000001',
   'owner', '{}', 'invited'),

  ('00000000-0000-4000-8000-000000000202',
   '00000000-0000-4000-8000-000000000001',
   'Demo Manager', 'manager@everest.test', '+977-98-0000002',
   'manager',
   array['00000000-0000-4000-8000-000000000101',
         '00000000-0000-4000-8000-000000000102']::uuid[],
   'invited'),

  ('00000000-0000-4000-8000-000000000203',
   '00000000-0000-4000-8000-000000000001',
   'Demo Front Desk', 'desk@everest.test', '+977-98-0000003',
   'front_desk',
   array['00000000-0000-4000-8000-000000000101']::uuid[],
   'invited'),

  ('00000000-0000-4000-8000-000000000204',
   '00000000-0000-4000-8000-000000000001',
   'Demo Trainer', 'trainer@everest.test', '+977-98-0000004',
   'trainer',
   array['00000000-0000-4000-8000-000000000103']::uuid[],
   'invited')
on conflict (id) do nothing;

-- Phase 1: a plan catalogue and a handful of members in every state the
-- dashboard has a tile for. Memberships are sold through the real RPC, as the
-- demo owner, so the seed exercises the same path the console does.

insert into public.membership_plans
  (id, org_id, name, description, plan_type, duration_days, session_count,
   price_paisa, signup_fee_paisa, branch_ids, sort_order)
values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001',
   'Monthly', 'Unlimited gym access for 30 days', 'time', 30, null,
   300000, 100000, '{}', 1),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000001',
   'Quarterly', 'Unlimited gym access for 90 days', 'time', 90, null,
   800000, 100000, '{}', 2),
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000001',
   'Annual', 'Unlimited gym access for 365 days', 'time', 365, null,
   2800000, 0, '{}', 3),
  ('00000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-000000000001',
   'PT 10 sessions', 'Ten personal-training sessions, valid 90 days', 'session_pack', 90, 10,
   1500000, 0,
   array['00000000-0000-4000-8000-000000000101']::uuid[], 4)
on conflict (id) do nothing;

insert into public.members
  (id, org_id, home_branch_id, full_name, phone, gender, joined_on)
values
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000101', 'Raj Bahadur Thapa', '9841000001', 'male', current_date - 60),
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000101', 'Sita Gurung', '9841000002', 'female', current_date - 25),
  ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000102', 'Bikash Shrestha', '9841000003', 'male', current_date - 100),
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000102', 'Anita Rai', '9841000004', 'female', current_date - 40),
  ('00000000-0000-4000-8000-000000000405', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000103', 'Prakash Lama', '9841000005', 'male', current_date - 10),
  ('00000000-0000-4000-8000-000000000406', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000103', 'Kamala Tamang', '9841000006', 'female', current_date - 3)
on conflict (id) do nothing;

do $$
declare
  org uuid := '00000000-0000-4000-8000-000000000001';
  owner_id uuid := '00000000-0000-4000-8000-000000000201';
  thamel uuid := '00000000-0000-4000-8000-000000000101';
  patan uuid := '00000000-0000-4000-8000-000000000102';
  baneshwor uuid := '00000000-0000-4000-8000-000000000103';
  monthly uuid := '00000000-0000-4000-8000-000000000301';
  quarterly uuid := '00000000-0000-4000-8000-000000000302';
  pt uuid := '00000000-0000-4000-8000-000000000304';
  r jsonb;
begin
  if exists (select 1 from public.memberships where org_id = org) then
    return;
  end if;

  -- Sell as the demo owner: the RPCs are SECURITY INVOKER and need claims.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org::text, 'staff_id', owner_id::text,
    'staff_role', 'owner', 'branch_ids', json_build_array()
  )::text, true);
  execute 'set local role authenticated';

  -- Active, fully paid, expiring within the week.
  perform public.renew_membership(
    '00000000-0000-4000-8000-000000000401', monthly, thamel,
    current_date - 25, 0, 400000, 'cash');

  -- Active, part paid: shows up in arrears and on the dues tile.
  perform public.renew_membership(
    '00000000-0000-4000-8000-000000000402', quarterly, thamel,
    current_date - 20, 0, 500000, 'esewa', 'ESW-DEMO-0002');

  -- Expired: sold long enough ago that the sweep closes it.
  perform public.renew_membership(
    '00000000-0000-4000-8000-000000000403', monthly, patan,
    current_date - 100, 0, 400000, 'cash');

  -- Frozen.
  r := public.renew_membership(
    '00000000-0000-4000-8000-000000000404', quarterly, patan,
    current_date - 30, 50000, 850000, 'khalti', 'KHL-DEMO-0004');
  perform public.freeze_membership((r ->> 'membership_id')::uuid, 'Travelling for a month');

  -- Session pack with dues outstanding, sold at Thamel where it is on sale.
  perform public.renew_membership(
    '00000000-0000-4000-8000-000000000405', pt, thamel,
    current_date - 5, 0, 1000000, 'fonepay', 'FP-DEMO-0005');

  -- Registered, never bought: the "expired" state a fresh walk-in sits in.
  -- (Kamala Tamang, member 406.)

  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  perform public.sweep_membership_expiry();
end $$;

-- Teardown:
-- delete from public.orgs where id = '00000000-0000-4000-8000-000000000001';
