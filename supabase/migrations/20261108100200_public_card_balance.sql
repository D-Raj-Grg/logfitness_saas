-- The public balance page. A member scans the QR on their card and lands on
-- …/balance?card_no=0004 (the gym's own site, or the console's public page).
-- Nobody signs in, so the page may show only what a stranger holding that card
-- could already guess: a masked name, the plan, whether it is active and how
-- many days are left. No phone, no dues, no member code.
--
-- Both RPCs are security definer and executable by service_role only: the
-- public-balance Edge Function calls them with the service key after
-- validating the input. The org is resolved by slug inside Postgres, so the
-- request body is never trusted for identity.
--
-- Also: orgs.settings.balance_url, the base link printed in the QR (the gym's
-- own site), added to the set_org_setting allow-list.

-- "Ramesh Thapa" -> "R•••• T••••". Each word keeps its first letter and gets
-- 2 to 4 dots, so the length gives little away either.
create or replace function public.mask_name(p_name text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    string_agg(
      left(w, 1) || repeat('•', greatest(2, least(4, length(w) - 1))),
      ' ' order by ord
    ),
    ''
  )
  from regexp_split_to_table(btrim(coalesce(p_name, '')), '\s+') with ordinality as t (w, ord)
  where w <> '';
$$;

-- Who is behind a printed number, for the public page. One of:
--   org_not_found | card_not_found | card_unassigned | ok
-- Not a chip, lost, retired, on the shelf, held by staff, or held by an
-- archived member all collapse to card_unassigned -- the page need not know why.
create or replace function public.public_card_lookup(p_org_slug text, p_card_no integer)
returns table (
  outcome text,
  org_id uuid,
  stock_id uuid,
  member_id uuid,
  full_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_stock public.card_stock%rowtype;
  v_member public.members%rowtype;
begin
  select o.id into v_org_id from public.orgs o where o.slug = p_org_slug;
  if not found then
    return query select 'org_not_found', null::uuid, null::uuid, null::uuid, null::text;
    return;
  end if;

  select * into v_stock
  from public.card_stock cs
  where cs.org_id = v_org_id and cs.card_no = p_card_no;
  if not found then
    return query select 'card_not_found', v_org_id, null::uuid, null::uuid, null::text;
    return;
  end if;

  if v_stock.card_uid is null or v_stock.status <> 'free'::public.card_stock_status then
    return query select 'card_unassigned', v_org_id, v_stock.id, null::uuid, null::text;
    return;
  end if;

  select m.* into v_member
  from public.member_cards mc
  join public.members m on m.id = mc.member_id
  where mc.org_id = v_org_id
    and mc.card_uid = v_stock.card_uid
    and mc.revoked_at is null
    and m.archived_at is null;
  if not found then
    return query select 'card_unassigned', v_org_id, v_stock.id, null::uuid, null::text;
    return;
  end if;

  return query select 'ok', v_org_id, v_stock.id, v_member.id, v_member.full_name;
end;
$$;

create or replace function public.public_card_balance(p_org_slug text, p_card_no integer)
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
begin
  select * into v_hit from public.public_card_lookup(p_org_slug, p_card_no);

  if v_hit.outcome = 'org_not_found' then
    return jsonb_build_object('result', 'org_not_found');
  elsif v_hit.outcome <> 'ok' then
    return jsonb_build_object('result', v_hit.outcome, 'card_no', public.format_card_no(p_card_no));
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

  return jsonb_build_object(
    'result', 'ok',
    'card_no', public.format_card_no(p_card_no),
    'name_masked', public.mask_name(v_hit.full_name),
    'plan_name', v_snap.plan_name,
    'status', coalesce(v_snap.banner, 'none'),
    'days_left', v_snap.days_to_expiry,
    'ends_on', v_ends_on,
    'renewal_pending', v_pending
  );
end;
$$;

-- "Please renew me." One pending row per member; a repeat within ten minutes
-- is answered too_soon, a later repeat is counted on the same row.
create or replace function public.public_renewal_request(
  p_org_slug text,
  p_card_no integer,
  p_phone text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hit record;
  v_phone text := nullif(left(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), 20), '');
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  v_row public.renewal_requests%rowtype;
begin
  select * into v_hit from public.public_card_lookup(p_org_slug, p_card_no);

  if v_hit.outcome = 'org_not_found' then
    return jsonb_build_object('result', 'org_not_found');
  elsif v_hit.outcome <> 'ok' then
    return jsonb_build_object('result', v_hit.outcome, 'card_no', public.format_card_no(p_card_no));
  end if;

  select * into v_row
  from public.renewal_requests r
  where r.member_id = v_hit.member_id
    and r.status = 'pending'::public.renewal_request_status
  for update;

  if found then
    if v_row.last_requested_at > now() - interval '10 minutes' then
      return jsonb_build_object('result', 'too_soon', 'card_no', public.format_card_no(p_card_no));
    end if;

    update public.renewal_requests r
    set request_count = r.request_count + 1,
        last_requested_at = now(),
        phone = coalesce(v_phone, r.phone),
        note = coalesce(v_note, r.note),
        card_stock_id = v_hit.stock_id
    where r.id = v_row.id;
  else
    insert into public.renewal_requests (org_id, member_id, card_stock_id, phone, note)
    values (v_hit.org_id, v_hit.member_id, v_hit.stock_id, v_phone, v_note);
  end if;

  return jsonb_build_object('result', 'ok', 'card_no', public.format_card_no(p_card_no));
end;
$$;

-- ---------------------------------------------------------------------------
-- orgs.settings.balance_url: where this gym's printed QR codes point. The
-- existing keys and checks are reproduced unchanged.
create or replace function public.set_org_setting(_key text, _value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.jwt_org_id();
  v_int integer;
  v_text text;
  v_result jsonb;
begin
  if v_org is null or not public.jwt_is_owner() then
    raise exception 'Only the owner can change gym preferences'
      using errcode = '42501';
  end if;

  if _key = 'class_cancellation_window_minutes' then
    if _value is null or jsonb_typeof(_value) <> 'number'
       or (_value #>> '{}') !~ '^[0-9]+$' then
      raise exception 'class_cancellation_window_minutes must be a whole number of minutes'
        using errcode = '22023';
    end if;
    v_int := (_value #>> '{}')::integer;
    if v_int < 0 or v_int > 10080 then
      raise exception 'class_cancellation_window_minutes must be between 0 and 10080'
        using errcode = '22023';
    end if;
  elsif _key = 'notification_locale' then
    if _value is null or jsonb_typeof(_value) <> 'string'
       or (_value #>> '{}') not in ('en', 'ne') then
      raise exception 'notification_locale must be "en" or "ne"'
        using errcode = '22023';
    end if;
  elsif _key = 'track_check_out' then
    if _value is null or jsonb_typeof(_value) <> 'boolean' then
      raise exception 'track_check_out must be true or false'
        using errcode = '22023';
    end if;
  elsif _key = 'balance_url' then
    -- null clears it (the console's own page serves). Otherwise an https URL
    -- (or localhost while developing) with no card_no of its own: the QR
    -- appends ?card_no=0004.
    if _value is not null and jsonb_typeof(_value) <> 'null' then
      if jsonb_typeof(_value) <> 'string' then
        raise exception 'balance_url must be a link or null' using errcode = '22023';
      end if;
      v_text := btrim(_value #>> '{}');
      if length(v_text) > 200
         or (v_text !~ '^https://[^\s]+$' and v_text !~ '^http://localhost(:[0-9]+)?(/[^\s]*)?$')
      then
        raise exception 'balance_url must be an https:// link of at most 200 characters'
          using errcode = '22023';
      end if;
      if v_text ~ '[?&]card_no=' then
        raise exception 'balance_url must not carry card_no itself; the card number is added to it'
          using errcode = '22023';
      end if;
      _value := to_jsonb(v_text);
    else
      _value := 'null'::jsonb;
    end if;
  else
    raise exception 'Unknown setting: %', _key using errcode = '22023';
  end if;

  update public.orgs
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array[_key], _value, true)
   where id = v_org
  returning settings into v_result;

  return v_result;
end;
$$;

-- Grants -----------------------------------------------------------------------
-- mask_name is a plain helper staff may use; the lookup is internal to the two
-- public RPCs; the public RPCs are for the Edge Function's service role only.
revoke execute on function public.mask_name(text) from public, anon;
grant execute on function public.mask_name(text) to authenticated;

revoke execute on function public.public_card_lookup(text, integer) from public, anon, authenticated;
revoke execute on function public.public_card_balance(text, integer) from public, anon, authenticated;
revoke execute on function public.public_renewal_request(text, integer, text, text) from public, anon, authenticated;
grant execute on function public.public_card_balance(text, integer) to service_role;
grant execute on function public.public_renewal_request(text, integer, text, text) to service_role;

revoke all on function public.set_org_setting(text, jsonb) from public, anon;
grant execute on function public.set_org_setting(text, jsonb) to authenticated;
