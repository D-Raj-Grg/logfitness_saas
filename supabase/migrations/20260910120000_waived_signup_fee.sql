-- A printed invoice has to be able to say the registration fee was waived, and
-- the waived amount exists nowhere today. Two facts are missing.
--
-- 1. orgs.standard_signup_fee_paisa -- the gym's list registration fee. A plan
--    priced with signup_fee_paisa = 0 and sold as "joining fee waived" (the
--    long-term tiers) carries no amount of its own to strike out. This is it.
-- 2. memberships.signup_fee_waived_paisa -- what was not charged, recorded at
--    the point of sale. It has to be stored, not recomputed later:
--    lib/print/line-items.ts already refuses to read the *charged* fee back off
--    membership_plans because the plan may have been repriced since, and a
--    wrong number on a tax document is worse than a missing one. The same is
--    true of the waiver. Rows written before this migration carry 0 and print
--    no waiver line, which is correct -- the fact does not exist for them.
--
-- Both are memo figures. Neither enters price_paisa, the invoice subtotal, or
-- any revenue report: nothing about what the gym actually charged changes here.

alter table public.orgs
  add column standard_signup_fee_paisa bigint not null default 0
    check (standard_signup_fee_paisa >= 0);

comment on column public.orgs.standard_signup_fee_paisa is
  'List registration fee, in paisa. Never charged on its own -- it is the reference amount a printed document strikes out when a plan or a renewal waives the joining fee.';

alter table public.memberships
  add column signup_fee_waived_paisa bigint not null default 0
    check (signup_fee_waived_paisa >= 0);

comment on column public.memberships.signup_fee_waived_paisa is
  'Registration fee that applied to this sale but was not charged, in paisa. Memo only: outside price_paisa and outside the invoice subtotal.';

-- Unchanged from 20260906120100 except for the waiver: the reference fee is
-- resolved and the difference recorded. SECURITY INVOKER as before, so the
-- orgs read is scoped by RLS like every other read in here.
create or replace function public.renew_membership(
  p_member_id uuid,
  p_plan_id uuid,
  p_branch_id uuid,
  p_start_date date default null,
  p_discount_paisa bigint default 0,
  p_amount_paid_paisa bigint default 0,
  p_method public.payment_method default 'cash',
  p_reference_no text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  actor uuid := public.jwt_staff_id();
  member public.members%rowtype;
  plan public.membership_plans%rowtype;
  previous public.memberships%rowtype;
  today date;
  starts_on date;
  ends_on date;
  subtotal bigint;
  signup_fee bigint := 0;
  org_signup_fee bigint := 0;
  reference_fee bigint := 0;
  signup_fee_waived bigint := 0;
  new_membership public.memberships%rowtype;
  new_invoice public.invoices%rowtype;
  new_payment_id uuid;
begin
  if actor is null then
    raise exception 'Only signed-in staff can sell a membership'
      using errcode = 'insufficient_privilege';
  end if;

  if p_discount_paisa < 0 or p_amount_paid_paisa < 0 then
    raise exception 'Amounts cannot be negative' using errcode = 'check_violation';
  end if;

  -- RLS scopes both reads, so a member or plan from another org simply is not
  -- there. No explicit org check is needed, or trusted.
  select * into member from public.members where id = p_member_id;
  if not found then
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;

  if member.status = 'left' then
    raise exception 'This member has left; reactivate them before selling a membership'
      using errcode = 'check_violation';
  end if;

  select * into plan from public.membership_plans where id = p_plan_id;
  if not found then
    raise exception 'Plan not found' using errcode = 'no_data_found';
  end if;

  if not plan.is_active then
    raise exception 'Plan % is no longer on sale', plan.name using errcode = 'check_violation';
  end if;

  if not public.plan_sold_at(plan.id, p_branch_id) then
    raise exception 'Plan % is not sold at this branch', plan.name
      using errcode = 'check_violation';
  end if;

  today := public.org_today(member.org_id);

  -- The membership this one follows: the latest that has not lapsed. A renewal
  -- taken early must not start until the current one runs out.
  select * into previous
  from public.memberships ms
  where ms.member_id = member.id
    and ms.status in ('active', 'upcoming', 'frozen')
  order by coalesce(ms.end_date, date '9999-12-31') desc, ms.start_date desc
  limit 1;

  starts_on := coalesce(
    p_start_date,
    case
      when previous.id is not null and previous.end_date is not null and previous.end_date >= today
        -- Start the day after the current one ends, so no day is covered twice.
        then previous.end_date + 1
      else today
    end
  );

  if plan.duration_days is not null then
    -- A 30-day plan starting on the 1st runs through the 30th, not the 31st.
    ends_on := starts_on + (plan.duration_days - 1);
  else
    ends_on := null;
  end if;

  -- The joining fee is charged once, on the member's first membership.
  if not exists (select 1 from public.memberships ms where ms.member_id = member.id) then
    signup_fee := plan.signup_fee_paisa;
  end if;

  -- What the fee would have been. A plan carrying its own fee sets the
  -- reference; a plan priced without one falls back to the gym's list fee, so
  -- a long-term tier sold as "joining fee waived" has an amount to show. The
  -- difference is what the member did not pay, and only that is recorded.
  select o.standard_signup_fee_paisa into org_signup_fee
  from public.orgs o
  where o.id = member.org_id;

  reference_fee := case
    when plan.signup_fee_paisa > 0 then plan.signup_fee_paisa
    else coalesce(org_signup_fee, 0)
  end;

  signup_fee_waived := greatest(reference_fee - signup_fee, 0);

  subtotal := plan.price_paisa + signup_fee;

  if p_discount_paisa > subtotal then
    raise exception 'Discount cannot exceed the price' using errcode = 'check_violation';
  end if;

  if p_amount_paid_paisa > subtotal - p_discount_paisa then
    raise exception 'Payment cannot exceed the amount due' using errcode = 'check_violation';
  end if;

  insert into public.memberships (
    org_id, branch_id, member_id, plan_id, plan_name, plan_type,
    start_date, end_date, sessions_total, sessions_remaining,
    price_paisa, signup_fee_paisa, signup_fee_waived_paisa, discount_paisa, status,
    previous_membership_id, sold_by, notes
  )
  values (
    member.org_id, p_branch_id, member.id, plan.id, plan.name, plan.plan_type,
    starts_on, ends_on,
    case when plan.plan_type = 'session_pack' then plan.session_count end,
    case when plan.plan_type = 'session_pack' then plan.session_count end,
    subtotal, signup_fee, signup_fee_waived, p_discount_paisa,
    (case when starts_on > today then 'upcoming' else 'active' end)::public.membership_status,
    previous.id, actor, p_notes
  )
  returning * into new_membership;

  insert into public.invoices (
    org_id, branch_id, member_id, membership_id,
    subtotal_paisa, discount_paisa, total_paisa, issued_on
  )
  values (
    member.org_id, p_branch_id, member.id, new_membership.id,
    subtotal, p_discount_paisa, subtotal - p_discount_paisa, today
  )
  returning * into new_invoice;

  if p_amount_paid_paisa > 0 then
    insert into public.payments (
      org_id, branch_id, member_id, membership_id, invoice_id,
      kind, amount_paisa, method, reference_no, collected_by
    )
    values (
      member.org_id, p_branch_id, member.id, new_membership.id, new_invoice.id,
      'payment', p_amount_paid_paisa, p_method, nullif(btrim(coalesce(p_reference_no, '')), ''), actor
    )
    returning id into new_payment_id;
  end if;

  return jsonb_build_object(
    'membership_id', new_membership.id,
    'invoice_id', new_invoice.id,
    'invoice_no', new_invoice.invoice_no,
    'payment_id', new_payment_id,
    'start_date', new_membership.start_date,
    'end_date', new_membership.end_date,
    'total_paisa', new_invoice.total_paisa,
    'due_paisa', (subtotal - p_discount_paisa) - p_amount_paid_paisa
  );
end;
$$;

-- create or replace keeps the existing ACL, but restating it means the grants
-- are readable in the migration that last touched the function.
revoke execute on function public.renew_membership(
  uuid, uuid, uuid, date, bigint, bigint, public.payment_method, text, text
) from public, anon;

grant execute on function public.renew_membership(
  uuid, uuid, uuid, date, bigint, bigint, public.payment_method, text, text
) to authenticated;
