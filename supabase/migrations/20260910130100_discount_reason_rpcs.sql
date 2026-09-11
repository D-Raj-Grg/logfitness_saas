-- The sale RPCs learn the discount reason.
--
-- Split from 20260910130000 the way reverse_payment split its schema from its
-- function: the columns are one reviewable change, and two long function
-- bodies restated in full are another.
--

-- Both RPCs gain the reason. The new parameters have defaults, which would
-- otherwise create an overload PostgREST cannot resolve, so the old signatures
-- are dropped rather than replaced -- and the grants restated, because a drop
-- takes the ACL with it.
drop function if exists public.register_member(
  text, text, uuid, text, date, public.member_gender, text, text, text, text,
  uuid, bigint, bigint, public.payment_method, text, date
);

drop function if exists public.renew_membership(
  uuid, uuid, uuid, date, bigint, bigint, public.payment_method, text, text
);

-- Unchanged from 20260910120000 except for the discount reason: validated
-- here, because the table constraints are NOT VALID and so cannot speak for
-- rows written before them.
create function public.renew_membership(
  p_member_id uuid,
  p_plan_id uuid,
  p_branch_id uuid,
  p_start_date date default null,
  p_discount_paisa bigint default 0,
  p_amount_paid_paisa bigint default 0,
  p_method public.payment_method default 'cash',
  p_reference_no text default null,
  p_notes text default null,
  p_discount_reason public.discount_reason default null,
  p_discount_note text default null
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
  discount_note text := nullif(btrim(coalesce(p_discount_note, '')), '');
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

  -- A discount the gym cannot explain later is a discount nobody can question
  -- now. The reason travels with the money or the sale does not happen.
  if p_discount_paisa > 0 and p_discount_reason is null then
    raise exception 'Choose a reason for the discount' using errcode = 'check_violation';
  end if;

  if p_discount_paisa = 0 and p_discount_reason is not null then
    raise exception 'There is no discount to give a reason for'
      using errcode = 'check_violation';
  end if;

  if p_discount_reason = 'other' and discount_note is null then
    raise exception 'Describe the discount reason' using errcode = 'check_violation';
  end if;

  -- A note on a named reason is noise; the label already says it.
  if p_discount_reason is distinct from 'other' then
    discount_note := null;
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
  -- a long-term tier sold without a joining fee has an amount to show. The
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
    price_paisa, signup_fee_paisa, signup_fee_waived_paisa,
    discount_paisa, discount_reason, discount_note, status,
    previous_membership_id, sold_by, notes
  )
  values (
    member.org_id, p_branch_id, member.id, plan.id, plan.name, plan.plan_type,
    starts_on, ends_on,
    case when plan.plan_type = 'session_pack' then plan.session_count end,
    case when plan.plan_type = 'session_pack' then plan.session_count end,
    subtotal, signup_fee, signup_fee_waived,
    p_discount_paisa, p_discount_reason, discount_note,
    (case when starts_on > today then 'upcoming' else 'active' end)::public.membership_status,
    previous.id, actor, p_notes
  )
  returning * into new_membership;

  insert into public.invoices (
    org_id, branch_id, member_id, membership_id,
    subtotal_paisa, discount_paisa, discount_reason, discount_note,
    total_paisa, issued_on
  )
  values (
    member.org_id, p_branch_id, member.id, new_membership.id,
    subtotal, p_discount_paisa, p_discount_reason, discount_note,
    subtotal - p_discount_paisa, today
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

revoke execute on function public.renew_membership(
  uuid, uuid, uuid, date, bigint, bigint, public.payment_method, text, text,
  public.discount_reason, text
) from public, anon;

grant execute on function public.renew_membership(
  uuid, uuid, uuid, date, bigint, bigint, public.payment_method, text, text,
  public.discount_reason, text
) to authenticated;

-- Unchanged from 20260907120100 except that the discount reason is carried
-- through to renew_membership, which owns the rule as it owns every other
-- part of the sale.
create function public.register_member(
  p_full_name text,
  p_phone text,
  p_home_branch_id uuid,
  p_email text default null,
  p_date_of_birth date default null,
  p_gender public.member_gender default null,
  p_address text default null,
  p_emergency_contact_name text default null,
  p_emergency_contact_phone text default null,
  p_notes text default null,
  p_plan_id uuid default null,
  p_discount_paisa bigint default 0,
  p_amount_paid_paisa bigint default 0,
  p_method public.payment_method default 'cash',
  p_reference_no text default null,
  p_start_date date default null,
  p_discount_reason public.discount_reason default null,
  p_discount_note text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := public.jwt_staff_id();
  v_org uuid := public.jwt_org_id();
  v_member public.members%rowtype;
  v_sale jsonb := null;
  v_message text;
  v_detail text;
  v_state text;
begin
  if v_actor is null or v_org is null then
    raise exception 'Only signed-in staff can register a member'
      using errcode = 'insufficient_privilege', hint = 'member';
  end if;

  if p_plan_id is null and (p_amount_paid_paisa <> 0 or p_discount_paisa <> 0) then
    raise exception 'Pick a plan before taking payment'
      using errcode = 'check_violation', hint = 'sale';
  end if;

  if p_plan_id is null and p_start_date is not null then
    raise exception 'Pick a plan before choosing a start date'
      using errcode = 'check_violation', hint = 'sale';
  end if;

  begin
    insert into public.members (
      org_id, home_branch_id, full_name, phone, email, date_of_birth, gender,
      address, emergency_contact_name, emergency_contact_phone, notes, created_by
    )
    values (
      v_org, p_home_branch_id, p_full_name, p_phone,
      nullif(btrim(coalesce(p_email, '')), ''),
      p_date_of_birth, p_gender,
      nullif(btrim(coalesce(p_address, '')), ''),
      nullif(btrim(coalesce(p_emergency_contact_name, '')), ''),
      nullif(btrim(coalesce(p_emergency_contact_phone, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''),
      v_actor
    )
    returning * into v_member;
  exception
    when unique_violation then
      raise exception 'A member with that phone number already exists'
        using errcode = 'unique_violation', hint = 'member';
    when insufficient_privilege then
      raise exception 'You can only register members at your own branch'
        using errcode = 'insufficient_privilege', hint = 'member';
  end;

  if p_plan_id is not null then
    begin
      v_sale := public.renew_membership(
        v_member.id,
        p_plan_id,
        p_home_branch_id,
        p_start_date,
        p_discount_paisa,
        p_amount_paid_paisa,
        p_method,
        p_reference_no,
        null,
        p_discount_reason,
        p_discount_note
      );
    exception
      when others then
        get stacked diagnostics
          v_message = message_text,
          v_state = returned_sqlstate,
          v_detail = pg_exception_detail;
        raise exception '%', v_message
          using errcode = v_state,
                detail = coalesce(v_detail, ''),
                hint = 'sale';
    end;
  end if;

  return jsonb_build_object(
    'member_id', v_member.id,
    'member_code', v_member.member_code,
    'sold', v_sale is not null
  ) || coalesce(v_sale, '{}'::jsonb);
end;
$$;

revoke execute on function public.register_member(
  text, text, uuid, text, date, public.member_gender, text, text, text, text,
  uuid, bigint, bigint, public.payment_method, text, date,
  public.discount_reason, text
) from public, anon;

grant execute on function public.register_member(
  text, text, uuid, text, date, public.member_gender, text, text, text, text,
  uuid, bigint, bigint, public.payment_method, text, date,
  public.discount_reason, text
) to authenticated;
