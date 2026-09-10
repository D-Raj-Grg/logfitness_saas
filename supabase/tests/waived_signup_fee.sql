-- Gate for the waived joining fee: what renew_membership records when the fee
-- applies but is not charged, and the guarantee that recording it changes no
-- money. The printed invoice reads memberships.signup_fee_waived_paisa and
-- nothing else, so this is the whole contract.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/waived_signup_fee.sql

do $$
declare
  org_w uuid := 'c1c1c1c1-1111-1111-1111-111111111111';
  br_w  uuid := 'c1b10000-0000-0000-0000-000000000001';
  st_w  uuid := 'c1c00000-0000-0000-0000-00000000000f';

  plan_with_fee uuid := 'c1d00000-0000-0000-0000-000000000001';
  plan_no_fee   uuid := 'c1d00000-0000-0000-0000-000000000002';

  member_a uuid;
  member_b uuid;
  member_c uuid;
  charged bigint;
  waived bigint;
  subtotal bigint;
begin
  insert into public.orgs (id, name, slug, standard_signup_fee_paisa)
  values (org_w, 'Waiver Gym', 'waiver-gym-test', 50000);

  insert into public.branches (id, org_id, name) values (br_w, org_w, 'Waiver One');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status)
  values (st_w, org_w, 'Waiver Owner', 'owner@waiver.test', 'owner', '{}', 'active');

  insert into public.membership_plans
    (id, org_id, name, plan_type, duration_days, price_paisa, signup_fee_paisa, branch_ids)
  values
    (plan_with_fee, org_w, 'Monthly With Fee', 'time', 30, 150000, 50000, array[br_w]),
    (plan_no_fee,   org_w, 'Six Months No Fee', 'time', 180, 720000, 0,    array[br_w]);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_w::text, 'staff_id', st_w::text, 'staff_role', 'owner'
  )::text, true);
  execute 'set local role authenticated';

  -- 1. First membership on a plan that carries its own fee: charged, nothing
  --    waived. The reference fee is the plan's, and it was taken in full.
  member_a := (public.register_member('Waiver A', '9840000001', br_w) ->> 'member_id')::uuid;
  perform public.renew_membership(member_a, plan_with_fee, br_w);

  select ms.signup_fee_paisa, ms.signup_fee_waived_paisa
    into charged, waived
  from public.memberships ms where ms.member_id = member_a;

  assert charged = 50000, format('first sale charged %s, expected 50000', charged);
  assert waived = 0, format('first sale waived %s, expected 0', waived);

  -- 2. The renewal of that same plan: the fee applied once and is not taken
  --    again, so the amount not taken is what gets recorded.
  perform public.renew_membership(member_a, plan_with_fee, br_w);

  select ms.signup_fee_paisa, ms.signup_fee_waived_paisa
    into charged, waived
  from public.memberships ms
  where ms.member_id = member_a
  order by ms.created_at desc limit 1;

  assert charged = 0, format('renewal charged %s, expected 0', charged);
  assert waived = 50000, format('renewal waived %s, expected 50000', waived);

  -- 3. A first membership on a plan priced without a fee of its own -- the
  --    long-term tiers sold as "joining fee waived". The org's list fee is
  --    what the invoice strikes out; without the fallback there is no amount
  --    to show and the selling point never reaches the paper.
  member_b := (public.register_member('Waiver B', '9840000002', br_w) ->> 'member_id')::uuid;
  perform public.renew_membership(member_b, plan_no_fee, br_w);

  select ms.signup_fee_paisa, ms.signup_fee_waived_paisa, i.subtotal_paisa
    into charged, waived, subtotal
  from public.memberships ms
  join public.invoices i on i.membership_id = ms.id
  where ms.member_id = member_b;

  assert charged = 0, format('zero-fee plan charged %s, expected 0', charged);
  assert waived = 50000, format('zero-fee plan waived %s, expected 50000', waived);

  -- 4. The waiver is a memo. It is outside the subtotal, so the member owes
  --    the plan price and not a paisa more. This is the assertion that keeps
  --    a display change from becoming a pricing change.
  assert subtotal = 720000,
    format('the waiver moved the subtotal to %s, expected 720000', subtotal);

  -- 5. A gym that has set no list fee prints no waiver at all. Nothing is
  --    invented for it.
  update public.orgs set standard_signup_fee_paisa = 0 where id = org_w;

  member_c := (public.register_member('Waiver C', '9840000003', br_w) ->> 'member_id')::uuid;
  perform public.renew_membership(member_c, plan_no_fee, br_w);

  select ms.signup_fee_waived_paisa into waived
  from public.memberships ms where ms.member_id = member_c;

  assert waived = 0, format('a gym with no list fee waived %s, expected 0', waived);

  -- teardown ----------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id = org_w;

  raise notice 'waived signup fee: all assertions passed';
end $$;
