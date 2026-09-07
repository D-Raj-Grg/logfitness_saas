-- Register today, start later.
--
-- The desk takes the money when the member is standing there, but the plan is
-- often meant to run from a date that has not arrived yet -- a member who signs
-- up on Friday for a batch that begins Sunday. renew_membership has always
-- taken a start date and already marks a future one 'upcoming'; registration
-- was the one door that passed null and forced today.
--
-- The argument goes last so every existing call keeps its meaning, and the old
-- 15-argument signature is dropped rather than left beside this one: two
-- overloads that differ only by a defaulted trailing argument make a named-
-- argument call from PostgREST ambiguous.

drop function if exists public.register_member(
  text, text, uuid, text, date, public.member_gender, text, text, text, text,
  uuid, bigint, bigint, public.payment_method, text
);

create or replace function public.register_member(
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
  -- Everything below is the optional sale. A null plan means register only.
  -- There is no branch argument: a member is sold to at the branch they were
  -- just registered into. A null start date leaves renew_membership to resolve
  -- it, which for a member with no prior membership is today.
  p_plan_id uuid default null,
  p_discount_paisa bigint default 0,
  p_amount_paid_paisa bigint default 0,
  p_method public.payment_method default 'cash',
  p_reference_no text default null,
  p_start_date date default null
)
returns jsonb
language plpgsql
security invoker
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

  -- Money with no invoice to land against would simply disappear.
  if p_plan_id is null and (p_amount_paid_paisa <> 0 or p_discount_paisa <> 0) then
    raise exception 'Pick a plan before taking payment'
      using errcode = 'check_violation', hint = 'sale';
  end if;

  if p_plan_id is null and p_start_date is not null then
    raise exception 'Pick a plan before choosing a start date'
      using errcode = 'check_violation', hint = 'sale';
  end if;

  -- org_id and created_by come from the caller's own claims, never from the
  -- argument list. A plain insert on purpose: prepare_member_row mints the
  -- member code and fills joined_on, derive_member_status sets the status, and
  -- the audit trigger records the actor. None of that is restated here.
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
      -- RLS refused the row: this is not a branch the caller works at.
      raise exception 'You can only register members at your own branch'
        using errcode = 'insufficient_privilege', hint = 'member';
  end;

  -- Delegated, not reimplemented. renew_membership already owns the joining-fee
  -- rule, plan_sold_at, the active-plan check, the discount and payment
  -- ceilings, invoice numbering and the payment row -- and the Flutter app and
  -- the profile dialog both go through it. A second copy here would be a second
  -- set of selling rules to keep in step.
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
        null
      );
    exception
      when others then
        get stacked diagnostics
          v_message = message_text,
          v_state = returned_sqlstate,
          v_detail = pg_exception_detail;
        -- Re-raised, never swallowed. The member insert above rolls back with
        -- it, which is the entire reason this function exists.
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
  uuid, bigint, bigint, public.payment_method, text, date
) from public, anon;

grant execute on function public.register_member(
  text, text, uuid, text, date, public.member_gender, text, text, text, text,
  uuid, bigint, bigint, public.payment_method, text, date
) to authenticated;
