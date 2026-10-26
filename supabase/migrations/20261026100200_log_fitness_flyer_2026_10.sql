-- LOG Fitness repriced. Data only; matches the October 2026 printed flyer.
--
--   Gym            1 mo 2,200 | 3 mo 5,808 (12% off) | 6 mo 10,560 (20%) | 12 mo 18,480 (30%)
--   Gym + Cardio   1 mo 3,000 | 3 mo 7,650 (15% off) | 6 mo 14,400 (20%) | 12 mo 25,200 (30%)
--   Admission fee 500, card fee 200, on every tier, once, on joining.
--
-- Three of the flyer tiers were already on sale under working names ("New Gym
-- 1 Months" and friends) with memberships attached, so they are renamed and
-- repriced in place -- ids kept, history intact. The one at 2,400 was simply
-- wrong. The other five are new rows. The eight old tiers come off sale and
-- take a suffix, because (org_id, name) is unique and the clean names belong
-- to the new rows now. Daily passes, Cardio Only and PT are untouched.
--
-- The fee is written as a single 700 in signup_fee_paisa for now. The card fee
-- columns exist (20261026100000) but the counter apps in staff hands still
-- compute price + signup_fee and would show a total 200 short of what the
-- database charges. 20261026100300 moves the 200 across once both apps are
-- out; until then the invoice prints one "Registration fee 700" line, which is
-- the right money.
--
-- Runs with no staff actor, so membership_plans_audit records a null actor
-- for these rows. Accepted: the migration file is the record.

update public.membership_plans
set is_active = false,
    name = name || ' (to Oct 2026)'
where org_id = '597b0fd6-263a-43c9-8c80-2c64e1b18591'
  and name in (
    'Gym Only - 1 Month', 'Gym Only - 3 Months', 'Gym Only - 6 Months', 'Gym Only - 12 Months',
    'Gym + Cardio - 1 Month', 'Gym + Cardio - 3 Months', 'Gym + Cardio - 6 Months', 'Gym + Cardio - 12 Months'
  );

update public.membership_plans
set name = 'Gym - 1 Month',
    price_paisa = 220000,
    signup_fee_paisa = 70000,
    sort_order = 1,
    description = 'Rs 2,200/mo. Registration Rs 500 and card fee Rs 200, paid on day one.'
where id = 'd6f1a639-becf-4c66-9b28-328a75c74e6c';

update public.membership_plans
set name = 'Gym + Cardio - 1 Month',
    price_paisa = 300000,
    signup_fee_paisa = 70000,
    sort_order = 5,
    description = 'Rs 3,000/mo. Registration Rs 500 and card fee Rs 200, paid on day one.'
where id = '55794aaa-a071-4f44-85fe-2834b2732840';

update public.membership_plans
set name = 'Gym + Cardio - 3 Months',
    price_paisa = 765000,
    signup_fee_paisa = 70000,
    sort_order = 6,
    description = 'Rs 7,650 total, ~Rs 2,550/mo. Save 15%.'
where id = '6ba8bcaf-2684-46a9-9195-ddb6398710f4';

insert into public.membership_plans (
  org_id, name, description, plan_type, duration_days,
  price_paisa, signup_fee_paisa, card_fee_paisa, branch_ids, is_active, sort_order
)
values
  ('597b0fd6-263a-43c9-8c80-2c64e1b18591', 'Gym - 3 Months',
   'Rs 5,808 total, ~Rs 1,936/mo. Save 12%.', 'time', 90,
   580800, 70000, 0, '{99040a59-a6bb-4fcb-aa1c-274b9c2e3072}', true, 2),
  ('597b0fd6-263a-43c9-8c80-2c64e1b18591', 'Gym - 6 Months',
   'Rs 10,560 total, ~Rs 1,760/mo. Save 20%.', 'time', 180,
   1056000, 70000, 0, '{99040a59-a6bb-4fcb-aa1c-274b9c2e3072}', true, 3),
  ('597b0fd6-263a-43c9-8c80-2c64e1b18591', 'Gym - 12 Months',
   'Rs 18,480 total, ~Rs 1,540/mo. Save 30%.', 'time', 365,
   1848000, 70000, 0, '{99040a59-a6bb-4fcb-aa1c-274b9c2e3072}', true, 4),
  ('597b0fd6-263a-43c9-8c80-2c64e1b18591', 'Gym + Cardio - 6 Months',
   'Rs 14,400 total, ~Rs 2,400/mo. Save 20%.', 'time', 180,
   1440000, 70000, 0, '{99040a59-a6bb-4fcb-aa1c-274b9c2e3072}', true, 7),
  ('597b0fd6-263a-43c9-8c80-2c64e1b18591', 'Gym + Cardio - 12 Months',
   'Rs 25,200 total, ~Rs 2,100/mo. Save 30%.', 'time', 365,
   2520000, 70000, 0, '{99040a59-a6bb-4fcb-aa1c-274b9c2e3072}', true, 8);

-- The list fee a document strikes out on a renewal: the combined 700 for now.
update public.orgs
set standard_signup_fee_paisa = 70000
where id = '597b0fd6-263a-43c9-8c80-2c64e1b18591';
