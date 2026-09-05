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

-- Teardown:
-- delete from public.orgs where id = '00000000-0000-4000-8000-000000000001';
