-- Fix to 20261111120000: the "last payment" on the public balance page.
--
-- That version skipped any payment that had a later reversal on the same
-- invoice and membership for at least its amount. Reversals are separate
-- negative rows with no link to the payment they undo, and invoice-less
-- payments all share a null invoice and membership, so ONE reversal cancelled
-- EVERY earlier payment: reversing the newest left the page showing nothing.
--
-- member_last_payment() pairs them properly. Walking the member's payments
-- and reversals in time order, each reversal cancels the payment it exactly
-- undoes (same invoice, membership, method and reference, same amount, latest
-- first); with no exact match it takes money back from the latest matching
-- payments (a partial reversal). The answer is the latest payment that still
-- has money standing, at what is left of it. Refunds are not counted: they are
-- not tied to a payment and the page says "last payment", not "balance".

create or replace function public.member_last_payment(p_member_id uuid)
returns table (paid_at timestamptz, amount_paisa bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  rec record;
  v_at timestamptz[] := '{}';
  v_left bigint[] := '{}';
  v_inv uuid[] := '{}';
  v_mem uuid[] := '{}';
  v_method text[] := '{}';
  v_ref text[] := '{}';
  v_take bigint;
  v_cut bigint;
  v_n integer;
  v_hit integer;
  j integer;
begin
  for rec in
    select p.kind::text as kind, p.paid_at as pay_at, p.amount_paisa as amt, p.invoice_id,
           p.membership_id, p.method::text as method, p.reference_no
    from public.payments p
    where p.member_id = p_member_id
      and p.kind in ('payment'::public.payment_kind, 'reversal'::public.payment_kind)
    order by p.paid_at, p.created_at, p.id
  loop
    if rec.kind = 'payment' then
      v_at := array_append(v_at, rec.pay_at);
      v_left := array_append(v_left, rec.amt);
      v_inv := array_append(v_inv, rec.invoice_id);
      v_mem := array_append(v_mem, rec.membership_id);
      v_method := array_append(v_method, rec.method);
      v_ref := array_append(v_ref, rec.reference_no);
    else
      v_take := -rec.amt;
      v_n := coalesce(array_length(v_at, 1), 0);
      v_hit := 0;

      -- the payment this reversal exactly undoes, latest first
      for j in reverse v_n..1 loop
        if v_left[j] = v_take
           and v_inv[j] is not distinct from rec.invoice_id
           and v_mem[j] is not distinct from rec.membership_id
           and v_method[j] = rec.method
           and v_ref[j] is not distinct from rec.reference_no
        then
          v_hit := j;
          exit;
        end if;
      end loop;

      if v_hit > 0 then
        v_left[v_hit] := 0;
      else
        -- a partial reversal: take it back from the latest matching payments
        for j in reverse v_n..1 loop
          exit when v_take <= 0;
          if v_left[j] > 0
             and v_inv[j] is not distinct from rec.invoice_id
             and v_mem[j] is not distinct from rec.membership_id
             and v_method[j] = rec.method
             and v_ref[j] is not distinct from rec.reference_no
          then
            v_cut := least(v_left[j], v_take);
            v_left[j] := v_left[j] - v_cut;
            v_take := v_take - v_cut;
          end if;
        end loop;
      end if;
    end if;
  end loop;

  v_n := coalesce(array_length(v_at, 1), 0);
  for j in reverse v_n..1 loop
    if v_left[j] > 0 then
      paid_at := v_at[j];
      amount_paisa := v_left[j];
      return next;
      return;
    end if;
  end loop;
  return;
end;
$$;

revoke all on function public.member_last_payment(uuid) from public, anon, authenticated;

create or replace function public.public_card_balance(p_org_slug text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hit record;
  v_snap record;
  v_ends_on date;
  v_pending boolean;
  v_phone text;
  v_currency text;
  v_tz text;
  v_paid_at timestamptz;
  v_paid_paisa bigint;
begin
  select * into v_hit from public.public_card_lookup_by_token(p_org_slug, p_token);

  if v_hit.outcome = 'org_not_found' then
    return jsonb_build_object('result', 'org_not_found');
  elsif v_hit.outcome = 'card_not_found' then
    return jsonb_build_object('result', 'card_not_found');
  elsif v_hit.outcome <> 'ok' then
    return jsonb_build_object('result', v_hit.outcome, 'card_no', public.format_card_no(v_hit.card_no));
  end if;

  select * into v_snap from public.attendance_snapshot(v_hit.member_id);

  select ms.end_date into v_ends_on
  from public.memberships ms
  where ms.id = v_snap.membership_id;

  select exists (
    select 1 from public.renewal_requests r
    where r.member_id = v_hit.member_id
      and r.status = 'pending'::public.renewal_request_status
  ) into v_pending;

  select m.phone into v_phone from public.members m where m.id = v_hit.member_id;

  select o.currency, o.timezone into v_currency, v_tz
  from public.orgs o where o.id = v_hit.org_id;

  select lp.paid_at, lp.amount_paisa into v_paid_at, v_paid_paisa
  from public.member_last_payment(v_hit.member_id) lp;

  return jsonb_build_object(
    'result', 'ok',
    'card_no', public.format_card_no(v_hit.card_no),
    'name_masked', public.mask_name(v_hit.full_name),
    'first_name', public.first_name_of(v_hit.full_name),
    'phone_hint', public.phone_hint(v_phone),
    'plan_name', v_snap.plan_name,
    'status', coalesce(v_snap.banner, 'none'),
    'days_left', v_snap.days_to_expiry,
    'ends_on', v_ends_on,
    'renewal_pending', v_pending,
    'last_payment_on',
      case when v_paid_at is null then null
           else (v_paid_at at time zone coalesce(v_tz, 'UTC'))::date end,
    'last_payment_paisa', v_paid_paisa,
    'currency', v_currency
  );
end;
$$;

revoke all on function public.public_card_balance(text, text) from public, anon, authenticated;
grant execute on function public.public_card_balance(text, text) to service_role;
