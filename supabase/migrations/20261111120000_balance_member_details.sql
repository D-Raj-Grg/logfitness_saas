-- The public balance page shows a little more of who the card belongs to and
-- when they last paid: the member's first name, the first five digits of their
-- mobile number (the rest as x), and the date and amount of the last payment.
--
-- It is still reached only with the card's random link token (20261111100000),
-- so it is what whoever holds the card can see -- not something a stranger can
-- walk through. The masked full name (name_masked) is still returned for the
-- console's own /balance page.
--
-- Last payment = the member's most recent kind 'payment' row that has not been
-- taken back in full. Reversals are separate negative rows with no link to the
-- original, so "taken back" means a later reversal on the same invoice and
-- membership for at least the same amount. Refunds and reversals themselves are
-- never shown. The date is in the gym's own timezone; the amount is integer
-- paisa and the currency is the org's, formatted by the page.

-- "Ramesh Thapa" -> "Ramesh". Null for an empty name.
create or replace function public.first_name_of(p_name text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif((regexp_split_to_array(btrim(coalesce(p_name, '')), '\s+'))[1], '');
$$;

-- "9825254929" -> "98252xxxxx"; "+977 9825254929" -> "98252xxxxx". The first
-- five digits of the national number, the rest as x. A number of five digits
-- or fewer would give everything away, so it shows nothing.
create or replace function public.phone_hint(p_phone text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if length(v_digits) = 13 and left(v_digits, 3) = '977' then
    v_digits := substr(v_digits, 4);
  end if;
  if length(v_digits) <= 5 then
    return null;
  end if;
  return left(v_digits, 5) || repeat('x', length(v_digits) - 5);
end;
$$;

revoke all on function public.first_name_of(text) from public, anon, authenticated;
revoke all on function public.phone_hint(text) from public, anon, authenticated;

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

  select p.paid_at, p.amount_paisa into v_paid_at, v_paid_paisa
  from public.payments p
  where p.member_id = v_hit.member_id
    and p.kind = 'payment'::public.payment_kind
    and not exists (
      select 1 from public.payments r
      where r.member_id = p.member_id
        and r.kind = 'reversal'::public.payment_kind
        and r.paid_at >= p.paid_at
        and r.invoice_id is not distinct from p.invoice_id
        and r.membership_id is not distinct from p.membership_id
        and -r.amount_paisa >= p.amount_paisa
    )
  order by p.paid_at desc
  limit 1;

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
