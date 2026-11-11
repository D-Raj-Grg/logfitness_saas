-- The balance page shows the member's first name and hides the rest: "Subhadra
-- Shrestha" -> "Subhadra xxxx" (one xxxx per further word, so the length of a
-- surname gives nothing away; a single-word name is shown as it is). Same idea
-- as the phone hint (98252xxxxx). Returned as `name_display` next to the
-- existing `first_name` and `name_masked`, which stay for other pages.

create or replace function public.name_hidden_surname(p_name text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif(
    coalesce((regexp_split_to_array(btrim(coalesce(p_name, '')), '\s+'))[1], '')
    || coalesce(
         (select ' ' || string_agg('xxxx', ' ')
          from unnest((regexp_split_to_array(btrim(coalesce(p_name, '')), '\s+'))[2:]) as w
          where w <> ''),
         ''),
    '');
$$;

revoke all on function public.name_hidden_surname(text) from public, anon, authenticated;

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
    'name_display', public.name_hidden_surname(v_hit.full_name),
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
