-- Gate for the discount reason: that a discount cannot be given without one,
-- that it reaches the invoice (which is what the member is handed), and that
-- it is as immutable as the amount it explains.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/discount_reason.sql

do $$
declare
  org_d uuid := 'd1d1d1d1-1111-1111-1111-111111111111';
  br_d  uuid := 'd1b10000-0000-0000-0000-000000000001';
  st_d  uuid := 'd1c00000-0000-0000-0000-00000000000f';
  plan_d uuid := 'd1d00000-0000-0000-0000-000000000001';

  member_a uuid;
  member_b uuid;
  reason public.discount_reason;
  note text;
  failed boolean;
begin
  insert into public.orgs (id, name, slug, standard_signup_fee_paisa)
  values (org_d, 'Discount Gym', 'discount-gym-test', 50000);

  insert into public.branches (id, org_id, name) values (br_d, org_d, 'Discount One');

  insert into public.staff (id, org_id, full_name, email, role, branch_ids, status)
  values (st_d, org_d, 'Discount Owner', 'owner@discount.test', 'owner', '{}', 'active');

  insert into public.membership_plans
    (id, org_id, name, plan_type, duration_days, price_paisa, signup_fee_paisa, branch_ids)
  values (plan_d, org_d, 'Monthly', 'time', 30, 300000, 50000, array[br_d]);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', gen_random_uuid()::text, 'role', 'authenticated',
    'org_id', org_d::text, 'staff_id', st_d::text, 'staff_role', 'owner'
  )::text, true);
  execute 'set local role authenticated';

  -- 1. Money off with nothing to explain it. This is the whole point: a
  --    discount the gym cannot account for later must not be sellable.
  failed := false;
  begin
    perform public.register_member('No Reason', '9830000001', br_d,
      p_plan_id => plan_d, p_discount_paisa => 30000);
  exception when check_violation then failed := true;
  end;
  assert failed, 'a discount was taken with no reason';

  -- 2. 'other' is the escape hatch, not a way around the rule.
  failed := false;
  begin
    perform public.register_member('No Note', '9830000002', br_d,
      p_plan_id => plan_d, p_discount_paisa => 30000, p_discount_reason => 'other');
  exception when check_violation then failed := true;
  end;
  assert failed, 'other was accepted without a note';

  -- 3. And the rule runs both ways -- a reason with no discount is a lie on a
  --    document, not a harmless extra field.
  failed := false;
  begin
    perform public.register_member('No Discount', '9830000003', br_d,
      p_plan_id => plan_d, p_discount_reason => 'student');
  exception when check_violation then failed := true;
  end;
  assert failed, 'a reason was recorded against no discount';

  -- 4. A valid reason lands on the membership AND the invoice. The invoice is
  --    the copy the member walks out with, so it is the one that matters.
  member_a := (public.register_member('Valid Reason', '9830000004', br_d,
    p_plan_id => plan_d, p_discount_paisa => 30000,
    p_discount_reason => 'festival') ->> 'member_id')::uuid;

  select ms.discount_reason, ms.discount_note into reason, note
  from public.memberships ms where ms.member_id = member_a;
  assert reason = 'festival', format('membership reason was %s, expected festival', reason);
  assert note is null, 'a named reason kept a note it should have dropped';

  select i.discount_reason into reason
  from public.invoices i where i.member_id = member_a;
  assert reason = 'festival', format('invoice reason was %s, expected festival', reason);

  -- 5. 'other' keeps what the desk typed.
  member_b := (public.register_member('Other Reason', '9830000005', br_d,
    p_plan_id => plan_d, p_discount_paisa => 20000,
    p_discount_reason => 'other',
    p_discount_note => 'Owner''s cousin') ->> 'member_id')::uuid;

  select ms.discount_note into note
  from public.memberships ms where ms.member_id = member_b;
  assert note = 'Owner''s cousin', format('note was %s', note);

  -- 6. Why a discount was given is part of what was sold. Rewriting it later
  --    is rewriting the sale.
  failed := false;
  begin
    update public.memberships set discount_reason = 'corporate'
    where member_id = member_a;
  exception when insufficient_privilege then failed := true;
  end;
  assert failed, 'a sold discount reason was rewritten';

  -- teardown ----------------------------------------------------------------------
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  delete from public.orgs where id = org_d;

  raise notice 'discount reason: all assertions passed';
end $$;
