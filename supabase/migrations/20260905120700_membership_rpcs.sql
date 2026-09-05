-- Multi-table writes live here, not in the application. A renewal touches
-- memberships, invoices, and payments; either all three land or none do. The
-- Flutter app will call the same functions.
--
-- Every function below is SECURITY INVOKER on purpose: the RLS policies are the
-- tenant boundary, and running as the caller means an RPC cannot become a way
-- around them.

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
security invoker
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
    price_paisa, discount_paisa, status,
    previous_membership_id, sold_by, notes
  )
  values (
    member.org_id, p_branch_id, member.id, plan.id, plan.name, plan.plan_type,
    starts_on, ends_on,
    case when plan.plan_type = 'session_pack' then plan.session_count end,
    case when plan.plan_type = 'session_pack' then plan.session_count end,
    subtotal, p_discount_paisa,
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

grant execute on function public.renew_membership(
  uuid, uuid, uuid, date, bigint, bigint, public.payment_method, text, text
) to authenticated;


-- Settling an existing invoice, in full or in part.
create or replace function public.record_payment(
  p_invoice_id uuid,
  p_amount_paisa bigint,
  p_method public.payment_method default 'cash',
  p_reference_no text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := public.jwt_staff_id();
  invoice public.invoices%rowtype;
  new_payment_id uuid;
begin
  if actor is null then
    raise exception 'Only signed-in staff can record a payment'
      using errcode = 'insufficient_privilege';
  end if;

  if p_amount_paisa <= 0 then
    raise exception 'A payment must be a positive amount; use refund_payment to give money back'
      using errcode = 'check_violation';
  end if;

  select * into invoice from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found' using errcode = 'no_data_found';
  end if;

  if invoice.status = 'void' then
    raise exception 'Invoice % is void', invoice.invoice_no using errcode = 'check_violation';
  end if;

  if p_amount_paisa > invoice.due_paisa then
    raise exception 'Payment exceeds the % outstanding on invoice %',
      invoice.due_paisa, invoice.invoice_no
      using errcode = 'check_violation';
  end if;

  insert into public.payments (
    org_id, branch_id, member_id, membership_id, invoice_id,
    kind, amount_paisa, method, reference_no, collected_by, notes
  )
  values (
    invoice.org_id, invoice.branch_id, invoice.member_id, invoice.membership_id, invoice.id,
    'payment', p_amount_paisa, p_method, nullif(btrim(coalesce(p_reference_no, '')), ''), actor, p_notes
  )
  returning id into new_payment_id;

  select * into invoice from public.invoices where id = p_invoice_id;

  return jsonb_build_object(
    'payment_id', new_payment_id,
    'invoice_id', invoice.id,
    'paid_paisa', invoice.paid_paisa,
    'due_paisa', invoice.due_paisa,
    'status', invoice.status
  );
end;
$$;

grant execute on function public.record_payment(
  uuid, bigint, public.payment_method, text, text
) to authenticated;


-- A refund is a negative payment row against the same invoice. Nothing is
-- edited and nothing is deleted, so the drawer still reconciles.
create or replace function public.refund_payment(
  p_payment_id uuid,
  p_amount_paisa bigint,
  p_reason text,
  p_method public.payment_method default null,
  p_reference_no text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := public.jwt_staff_id();
  original public.payments%rowtype;
  refundable bigint;
  refund_id uuid;
begin
  if actor is null then
    raise exception 'Only signed-in staff can record a refund'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A refund must record a reason' using errcode = 'check_violation';
  end if;

  if p_amount_paisa <= 0 then
    raise exception 'Give the refund as a positive amount; it is stored negative'
      using errcode = 'check_violation';
  end if;

  select * into original from public.payments where id = p_payment_id;
  if not found then
    raise exception 'Payment not found' using errcode = 'no_data_found';
  end if;

  if original.kind <> 'payment' then
    raise exception 'Only a payment can be refunded' using errcode = 'check_violation';
  end if;

  -- Payments carry no link to the refund that reverses them, so the ceiling is
  -- checked at the invoice level: never give back more than came in.
  if original.invoice_id is null then
    refundable := original.amount_paisa;
  else
    select coalesce(sum(p.amount_paisa), 0) into refundable
    from public.payments p
    where p.invoice_id = original.invoice_id;
  end if;

  if p_amount_paisa > refundable then
    raise exception 'Refund exceeds the % still held against this invoice', refundable
      using errcode = 'check_violation';
  end if;

  insert into public.payments (
    org_id, branch_id, member_id, membership_id, invoice_id,
    kind, amount_paisa, method, reference_no, reason, collected_by
  )
  values (
    original.org_id, original.branch_id, original.member_id,
    original.membership_id, original.invoice_id,
    'refund', -p_amount_paisa, coalesce(p_method, original.method),
    nullif(btrim(coalesce(p_reference_no, '')), ''), btrim(p_reason), actor
  )
  returning id into refund_id;

  return jsonb_build_object('refund_id', refund_id, 'amount_paisa', -p_amount_paisa);
end;
$$;

grant execute on function public.refund_payment(
  uuid, bigint, text, public.payment_method, text
) to authenticated;


-- FREEZE ---------------------------------------------------------------------
-- A frozen membership stops counting down. Unfreezing pushes the end date out by
-- exactly the days it was paused, so the member loses nothing.
create or replace function public.freeze_membership(
  p_membership_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  membership public.memberships%rowtype;
  today date;
begin
  select * into membership from public.memberships where id = p_membership_id;
  if not found then
    raise exception 'Membership not found' using errcode = 'no_data_found';
  end if;

  if membership.status <> 'active' then
    raise exception 'Only an active membership can be frozen' using errcode = 'check_violation';
  end if;

  today := public.org_today(membership.org_id);

  update public.memberships
     set status = 'frozen',
         frozen_on = today,
         notes = coalesce(p_notes, notes)
   where id = membership.id
  returning * into membership;

  return jsonb_build_object('membership_id', membership.id, 'frozen_on', membership.frozen_on);
end;
$$;

grant execute on function public.freeze_membership(uuid, text) to authenticated;


create or replace function public.unfreeze_membership(p_membership_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  membership public.memberships%rowtype;
  today date;
  paused_days integer;
begin
  select * into membership from public.memberships where id = p_membership_id;
  if not found then
    raise exception 'Membership not found' using errcode = 'no_data_found';
  end if;

  if membership.status <> 'frozen' then
    raise exception 'This membership is not frozen' using errcode = 'check_violation';
  end if;

  today := public.org_today(membership.org_id);
  paused_days := greatest(today - membership.frozen_on, 0);

  update public.memberships
     set status = 'active',
         frozen_on = null,
         frozen_days = frozen_days + paused_days,
         end_date = case
           when end_date is null then null
           else end_date + paused_days
         end
   where id = membership.id
  returning * into membership;

  return jsonb_build_object(
    'membership_id', membership.id,
    'paused_days', paused_days,
    'end_date', membership.end_date
  );
end;
$$;

grant execute on function public.unfreeze_membership(uuid) to authenticated;


create or replace function public.cancel_membership(
  p_membership_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  membership public.memberships%rowtype;
begin
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A cancellation must record a reason' using errcode = 'check_violation';
  end if;

  select * into membership from public.memberships where id = p_membership_id;
  if not found then
    raise exception 'Membership not found' using errcode = 'no_data_found';
  end if;

  if membership.status in ('cancelled', 'expired') then
    raise exception 'This membership is already closed' using errcode = 'check_violation';
  end if;

  update public.memberships
     set status = 'cancelled',
         cancelled_at = now(),
         cancel_reason = btrim(p_reason)
   where id = membership.id
  returning * into membership;

  return jsonb_build_object('membership_id', membership.id, 'status', membership.status);
end;
$$;

grant execute on function public.cancel_membership(uuid, text) to authenticated;


-- Leaving is a member-level fact, not a membership one, and the status trigger
-- picks it up from left_on.
create or replace function public.set_member_left(
  p_member_id uuid,
  p_reason text default null,
  p_left_on date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  member public.members%rowtype;
begin
  select * into member from public.members where id = p_member_id;
  if not found then
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;

  update public.members
     set left_on = coalesce(p_left_on, public.org_today(member.org_id)),
         left_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = member.id
  returning * into member;

  return jsonb_build_object('member_id', member.id, 'status', member.status);
end;
$$;

grant execute on function public.set_member_left(uuid, text, date) to authenticated;


create or replace function public.reactivate_member(p_member_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  member public.members%rowtype;
begin
  update public.members
     set left_on = null,
         left_reason = null
   where id = p_member_id
  returning * into member;

  if not found then
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;

  return jsonb_build_object('member_id', member.id, 'status', member.status);
end;
$$;

grant execute on function public.reactivate_member(uuid) to authenticated;
