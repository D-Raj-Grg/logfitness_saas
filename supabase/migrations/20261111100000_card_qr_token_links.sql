-- Card QR links carry a random per-card token instead of the card number.
--
-- Until now the printed QR opened …/balance?card_no=0004, so anyone could type
-- 0001..9999 and read every member's masked name, plan and days left, or file
-- renewal requests against them. The QR now opens …/balance?c=0004_k3x9q2mf:
-- the card number, an underscore and eight random characters. The public
-- balance + renewal RPCs resolve a card by that token only.
--
-- card_stock.qr_token already existed (32 hex chars, unused, immutable). It is
-- reused, in the new shape, and stays immutable. Nothing was printed with the
-- old links, so there is no legacy path: the integer-keyed public RPCs are
-- dropped. public_card_lookup(slug, card_no) stays -- the member app's PIN
-- login resolves a typed card number through it and is a separate, PIN-gated path.
--
-- Also: set_org_setting's balance_url check now refuses a base link that
-- already carries c= (the token is appended to it). The body is the live one
-- from 20261109130100 with only that branch changed.

-- ---------------------------------------------------------------------------
-- Token generator: "0004_k3x9q2mf". 8 chars from a 32-symbol alphabet (a-z
-- without l and o, plus 2-9) -- one byte & 31 per char, so no modulo bias.
create or replace function public.new_card_token(p_card_no integer)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c_alphabet constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_tail text := '';
  i integer;
begin
  for i in 0..7 loop
    v_tail := v_tail || substr(c_alphabet, (get_byte(v_bytes, i) & 31) + 1, 1);
  end loop;
  return public.format_card_no(p_card_no) || '_' || v_tail;
end;
$$;

revoke all on function public.new_card_token(integer) from public, anon, authenticated;

-- Any insert path (the range RPC, a superuser fixing data, a test) gets a token
-- without having to know about it. BEFORE triggers run ahead of NOT NULL.
create or replace function public.card_stock_set_token()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.qr_token is null then
    new.qr_token := public.new_card_token(new.card_no);
  end if;
  return new;
end;
$$;

revoke all on function public.card_stock_set_token() from public, anon, authenticated;

alter table public.card_stock alter column qr_token drop default;

create trigger card_stock_set_token
  before insert on public.card_stock
  for each row execute function public.card_stock_set_token();

-- Re-key every existing card. One-off data fix, so the user triggers (audit,
-- immutability guard, updated_at) are off for it: 70 token rewrites are not
-- audit events and the guard exists to stop exactly this edit from the app.
alter table public.card_stock disable trigger user;
update public.card_stock set qr_token = public.new_card_token(card_no);
alter table public.card_stock enable trigger user;

alter table public.card_stock
  add constraint card_stock_qr_token_format
  check (
    qr_token ~ '^[0-9]{4}_[a-z2-9]{8}$'
    and left(qr_token, 4) = lpad(card_no::text, 4, '0')
  );

comment on column public.card_stock.qr_token is
  'Random per-card link token printed in the QR: <card no>_<8 chars>. The public balance page resolves a card by this and nothing else. Immutable.';

-- ---------------------------------------------------------------------------
-- Numbering a run now also hands back each card's token, so the designer can
-- put it in the QR. Same checks and locking as before.
create or replace function public.create_card_stock_range(
  p_from integer,
  p_to integer,
  p_design_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := public.jwt_org_id();
  v_staff_id uuid := public.jwt_staff_id();
  v_clash integer;
  v_batch_id uuid;
  v_cards jsonb;
begin
  if v_org_id is null or v_staff_id is null
     or not coalesce(
       public.jwt_staff_role() in ('owner'::public.staff_role, 'manager'::public.staff_role),
       false
     )
  then
    raise exception 'Only owners and managers can number cards'
      using errcode = 'insufficient_privilege';
  end if;

  if p_from is null or p_to is null or p_from < 1 or p_to > 9999 or p_to < p_from then
    raise exception 'A card range runs from 1 to 9999, low to high'
      using errcode = 'check_violation';
  end if;

  if p_to - p_from + 1 > 500 then
    raise exception 'Number at most 500 cards at a time'
      using errcode = 'check_violation';
  end if;

  -- One numbering at a time per org, so the clash check below is the truth.
  perform pg_advisory_xact_lock(hashtextextended('card_stock_range:' || v_org_id::text, 0));

  select min(cs.card_no) into v_clash
  from public.card_stock cs
  where cs.org_id = v_org_id and cs.card_no between p_from and p_to;
  if v_clash is not null then
    raise exception 'Card % already exists', public.format_card_no(v_clash)
      using errcode = 'unique_violation';
  end if;

  insert into public.card_batches (org_id, design_id, from_no, to_no, created_by)
  values (v_org_id, p_design_id, p_from, p_to, v_staff_id)
  returning id into v_batch_id;

  with ins as (
    insert into public.card_stock (org_id, card_no, batch_id, design_id, created_by)
    select v_org_id, g, v_batch_id, p_design_id, v_staff_id
    from generate_series(p_from, p_to) as g
    returning card_no, qr_token
  )
  select coalesce(
           jsonb_agg(jsonb_build_object('card_no', i.card_no, 'token', i.qr_token) order by i.card_no),
           '[]'::jsonb
         )
    into v_cards
  from ins i;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'from_no', p_from,
    'to_no', p_to,
    'created', jsonb_array_length(v_cards),
    'cards', v_cards
  );
end;
$$;

-- "Download again" for an earlier run: every card's number and token in the
-- batch. Owner or manager, own org only -- same bar as numbering them.
create or replace function public.card_batch_qr_tokens(p_batch_id uuid)
returns table (card_no integer, qr_token text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := public.jwt_org_id();
begin
  if v_org_id is null
     or not coalesce(
       public.jwt_staff_role() in ('owner'::public.staff_role, 'manager'::public.staff_role),
       false
     )
  then
    raise exception 'Only owners and managers can print cards'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  select cs.card_no, cs.qr_token
  from public.card_stock cs
  where cs.org_id = v_org_id and cs.batch_id = p_batch_id
  order by cs.card_no;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public lookup by token. Finds the card by (org, token), then asks the
-- existing number-keyed lookup who holds it, so the rules for assigned / lost /
-- archived / left live in one place. An unknown token is card_not_found.
create or replace function public.public_card_lookup_by_token(p_org_slug text, p_token text)
returns table (
  outcome text,
  org_id uuid,
  stock_id uuid,
  member_id uuid,
  full_name text,
  card_no integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_card_no integer;
begin
  select o.id into v_org_id from public.orgs o where o.slug = p_org_slug;
  if not found then
    return query select 'org_not_found', null::uuid, null::uuid, null::uuid, null::text, null::integer;
    return;
  end if;

  select cs.card_no into v_card_no
  from public.card_stock cs
  where cs.org_id = v_org_id and cs.qr_token = p_token;
  if not found then
    return query select 'card_not_found', v_org_id, null::uuid, null::uuid, null::text, null::integer;
    return;
  end if;

  return query
  select l.outcome, l.org_id, l.stock_id, l.member_id, l.full_name, v_card_no
  from public.public_card_lookup(p_org_slug, v_card_no) l;
end;
$$;

revoke all on function public.public_card_lookup_by_token(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The two public RPCs now take the token. The integer overloads are dropped:
-- leaving them would keep the enumeration hole open for anyone who calls the
-- function directly.
drop function if exists public.public_card_balance(text, integer);
drop function if exists public.public_renewal_request(text, integer, text, text);

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

  return jsonb_build_object(
    'result', 'ok',
    'card_no', public.format_card_no(v_hit.card_no),
    'name_masked', public.mask_name(v_hit.full_name),
    'plan_name', v_snap.plan_name,
    'status', coalesce(v_snap.banner, 'none'),
    'days_left', v_snap.days_to_expiry,
    'ends_on', v_ends_on,
    'renewal_pending', v_pending
  );
end;
$$;

-- "Please renew me." Body is the live one from 20261108100230 (per-member
-- ten-minute repeat rule, org cap of 30 new requests an hour); only the way
-- the card is found changes.
create or replace function public.public_renewal_request(
  p_org_slug text,
  p_token text,
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
  v_card text;
  v_phone text := nullif(left(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), 20), '');
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  v_row public.renewal_requests%rowtype;
  v_inserted boolean := false;
  v_recent integer;
begin
  select * into v_hit from public.public_card_lookup_by_token(p_org_slug, p_token);

  if v_hit.outcome = 'org_not_found' then
    return jsonb_build_object('result', 'org_not_found');
  elsif v_hit.outcome = 'card_not_found' then
    return jsonb_build_object('result', 'card_not_found');
  end if;

  v_card := public.format_card_no(v_hit.card_no);

  if v_hit.outcome <> 'ok' then
    return jsonb_build_object('result', v_hit.outcome, 'card_no', v_card);
  end if;

  select * into v_row
  from public.renewal_requests r
  where r.member_id = v_hit.member_id
    and r.status = 'pending'::public.renewal_request_status
  for update;

  if not found then
    select count(*) into v_recent
    from public.renewal_requests r
    where r.org_id = v_hit.org_id
      and r.requested_at > now() - interval '1 hour';
    if v_recent >= 30 then
      return jsonb_build_object('result', 'too_soon', 'card_no', v_card);
    end if;

    insert into public.renewal_requests (org_id, member_id, card_stock_id, phone, note)
    values (v_hit.org_id, v_hit.member_id, v_hit.stock_id, v_phone, v_note)
    on conflict (member_id) where status = 'pending'::public.renewal_request_status do nothing;
    v_inserted := found;

    if v_inserted then
      return jsonb_build_object('result', 'ok', 'card_no', v_card);
    end if;

    select * into v_row
    from public.renewal_requests r
    where r.member_id = v_hit.member_id
      and r.status = 'pending'::public.renewal_request_status
    for update;
  end if;

  if v_row.last_requested_at > now() - interval '10 minutes' then
    return jsonb_build_object('result', 'too_soon', 'card_no', v_card);
  end if;

  update public.renewal_requests r
  set request_count = r.request_count + 1,
      last_requested_at = now(),
      phone = coalesce(r.phone, v_phone),
      note = coalesce(r.note, v_note),
      card_stock_id = coalesce(r.card_stock_id, v_hit.stock_id)
  where r.id = v_row.id;

  return jsonb_build_object('result', 'ok', 'card_no', v_card);
end;
$$;

-- ---------------------------------------------------------------------------
-- set_org_setting: balance_url must not carry c= either. Everything else is
-- the live body (20261109130100), reproduced unchanged.
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
  v_days integer[];
  v_result jsonb;
begin
  if v_org is null
     or not (
       coalesce(public.jwt_is_owner(), false)
       or (_key = 'weekly_off'
           and coalesce(public.jwt_staff_role() = 'manager'::public.staff_role, false))
     )
  then
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
      if v_text ~ '[?&](card_no|c)=' then
        raise exception 'balance_url must not carry c= or card_no= itself; each card''s token is added to it'
          using errcode = '22023';
      end if;
      _value := to_jsonb(v_text);
    else
      _value := 'null'::jsonb;
    end if;
  elsif _key = 'weekly_off' then
    -- A JSON array of ISO weekdays, 1 (Monday) to 7 (Sunday). [] means the gym
    -- is open every day. Stored sorted and deduplicated.
    if _value is null or jsonb_typeof(_value) <> 'array' then
      raise exception 'weekly_off must be a list of weekdays, each 1 (Monday) to 7 (Sunday)'
        using errcode = '22023';
    end if;
    if jsonb_array_length(_value) > 7
       or exists (
         select 1 from jsonb_array_elements(_value) e
         where jsonb_typeof(e) <> 'number' or (e #>> '{}') !~ '^[1-7]$'
       )
    then
      raise exception 'weekly_off must be a list of weekdays, each 1 (Monday) to 7 (Sunday)'
        using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct (e #>> '{}')::integer order by (e #>> '{}')::integer), '{}')
      into v_days
    from jsonb_array_elements(_value) e;
    _value := to_jsonb(v_days);
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

-- ---------------------------------------------------------------------------
-- Grants. New functions get EXECUTE for anon/authenticated by default; close
-- that and open only what each is for.
revoke all on function public.create_card_stock_range(integer, integer, uuid) from public, anon;
grant execute on function public.create_card_stock_range(integer, integer, uuid) to authenticated;

revoke all on function public.card_batch_qr_tokens(uuid) from public, anon;
grant execute on function public.card_batch_qr_tokens(uuid) to authenticated;

revoke all on function public.public_card_balance(text, text) from public, anon, authenticated;
revoke all on function public.public_renewal_request(text, text, text, text) from public, anon, authenticated;
grant execute on function public.public_card_balance(text, text) to service_role;
grant execute on function public.public_renewal_request(text, text, text, text) to service_role;

revoke all on function public.set_org_setting(text, jsonb) from public, anon;
grant execute on function public.set_org_setting(text, jsonb) to authenticated;
