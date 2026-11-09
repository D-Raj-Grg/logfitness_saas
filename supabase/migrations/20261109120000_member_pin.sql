-- Member app PIN login (backend).
--
-- A member signs in to the Flutter app with a card number or phone number plus
-- a 4-6 digit PIN the desk sets. The member-login Edge Function (service role)
-- resolves the identifier (member_login_lookup), checks the PIN
-- (verify_member_pin) and mints a normal Supabase session for the member's
-- auth user, so every existing member RLS policy and RPC keeps working.
--
-- member_pins is deliberately NOT audited by audit_row (it would copy pin_hash
-- into audit_log); set/clear write a hand-built audit entry with no secret.

create table public.member_pins (
  member_id uuid primary key,
  org_id uuid not null,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  set_by uuid,
  set_at timestamptz not null default now(),
  constraint member_pins_member_fkey
    foreign key (member_id, org_id) references public.members (id, org_id)
    on delete cascade,
  constraint member_pins_set_by_fkey
    foreign key (set_by, org_id) references public.staff (id, org_id)
    on delete set null (set_by)
);

alter table public.member_pins enable row level security;
revoke all on public.member_pins from public, anon, authenticated;

comment on table public.member_pins is
  'Bcrypt PIN per member for app login. RLS on, no policies, no client grants: reached only through the security definer functions. Not audited by trigger (would leak pin_hash).';

-- ---------------------------------------------------------------------------
-- verify_member_pin: always one bcrypt compare, whether or not a row exists.
create or replace function public.verify_member_pin(p_member_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- bcrypt cost 8 hash of a throwaway string, compared when there is no row so
  -- timing does not reveal whether the member has a PIN.
  c_dummy constant text := '$2a$08$8thlVjaMrDHLDartqStKbuhgAQl47Dx.eDuIfTwv7xJMuFz6pKbg6';
  v_row public.member_pins%rowtype;
  v_have boolean;
  v_match boolean;
  v_attempts integer;
begin
  select * into v_row from public.member_pins where member_id = p_member_id for update;
  v_have := found;

  v_match := extensions.crypt(coalesce(p_pin, ''), case when v_have then v_row.pin_hash else c_dummy end)
             = case when v_have then v_row.pin_hash else c_dummy end;

  if not v_have then
    return jsonb_build_object('result', 'invalid');
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object(
      'result', 'locked',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_row.locked_until - now())))::integer)
    );
  end if;

  if v_match then
    if v_row.failed_attempts <> 0 or v_row.locked_until is not null then
      update public.member_pins set failed_attempts = 0, locked_until = null
      where member_id = p_member_id;
    end if;
    return jsonb_build_object('result', 'ok');
  end if;

  v_attempts := v_row.failed_attempts + 1;
  if v_attempts >= 5 then
    update public.member_pins
    set failed_attempts = 0, locked_until = now() + interval '15 minutes'
    where member_id = p_member_id;
    return jsonb_build_object('result', 'locked', 'retry_after_seconds', 900);
  end if;

  update public.member_pins set failed_attempts = v_attempts, locked_until = null
  where member_id = p_member_id;
  return jsonb_build_object('result', 'invalid');
end;
$$;

-- ---------------------------------------------------------------------------
-- member_login_lookup: identifier -> member_id (or null).
--   1-4 digits  printed card number (card_stock -> live member_cards -> member)
--   7-15 digits phone, compared on digits only; when both sides have 10+ digits
--               the last 10 are compared (country code tolerated); two members
--               matching -> null
--   anything else -> null
create or replace function public.member_login_lookup(p_org_slug text, p_identifier text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_digits text := regexp_replace(coalesce(p_identifier, ''), '\D', '', 'g');
  v_len integer := length(v_digits);
  v_org uuid;
  v_hit record;
  v_ids uuid[];
begin
  if v_len between 1 and 4 then
    select * into v_hit from public.public_card_lookup(p_org_slug, v_digits::integer);
    if v_hit.outcome = 'ok' then
      return v_hit.member_id;
    end if;
    return null;
  end if;

  if v_len < 7 or v_len > 15 then
    return null;
  end if;

  select o.id into v_org from public.orgs o
  where o.slug = p_org_slug and o.status = 'active'::public.org_status;
  if v_org is null then
    return null;
  end if;

  select array_agg(m.id) into v_ids
  from public.members m
  where m.org_id = v_org
    and m.archived_at is null
    and m.status <> 'left'::public.member_status
    and (
      regexp_replace(m.phone, '\D', '', 'g') = v_digits
      or (
        v_len >= 10
        and length(regexp_replace(m.phone, '\D', '', 'g')) >= 10
        and right(regexp_replace(m.phone, '\D', '', 'g'), 10) = right(v_digits, 10)
      )
    );

  if v_ids is null or array_length(v_ids, 1) <> 1 then
    return null;
  end if;
  return v_ids[1];
end;
$$;

-- ---------------------------------------------------------------------------
-- Desk side. Staff roles owner / manager / front_desk, scoped like the member
-- edit policy: same org and a branch the staff member can reach.
create or replace function public.member_pin_authorize(p_member_id uuid)
returns public.members
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member public.members%rowtype;
begin
  if public.jwt_org_id() is null or public.jwt_staff_id() is null
     or not coalesce(public.jwt_can_serve_members(), false)
  then
    raise exception 'Only front desk, managers and owners can manage member PINs'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_member from public.members where id = p_member_id;
  if not found
     or v_member.org_id <> public.jwt_org_id()
     or not (public.jwt_is_owner() or public.has_branch_access(v_member.home_branch_id))
  then
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;
  return v_member;
end;
$$;

create or replace function public.member_pin_audit(p_member public.members, p_before boolean, p_after boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  -- Records that a PIN was set / cleared / reset. Never the PIN or the hash.
  insert into public.audit_log (org_id, branch_id, actor_staff_id, actor_auth_user_id,
                                action, entity, entity_id, before, after)
  values (p_member.org_id, p_member.home_branch_id, public.jwt_staff_id(), auth.uid(),
          'UPDATE', 'member_pins', p_member.id::text,
          jsonb_build_object('has_pin', p_before), jsonb_build_object('has_pin', p_after));
$$;

create or replace function public.set_member_pin(p_member_id uuid, p_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members%rowtype;
  v_pin text := p_pin;
  v_generated boolean := p_pin is null;
  v_had boolean;
begin
  v_member := public.member_pin_authorize(p_member_id);

  if v_pin is null then
    v_pin := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');
  elsif v_pin !~ '^[0-9]{4,6}$' then
    raise exception 'A PIN is 4 to 6 digits' using errcode = 'check_violation';
  end if;

  select exists (select 1 from public.member_pins where member_id = p_member_id) into v_had;

  insert into public.member_pins (member_id, org_id, pin_hash, failed_attempts, locked_until, set_by, set_at)
  values (p_member_id, v_member.org_id, extensions.crypt(v_pin, extensions.gen_salt('bf', 8)),
          0, null, public.jwt_staff_id(), now())
  on conflict (member_id) do update
    set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null,
        set_by = excluded.set_by, set_at = excluded.set_at;

  perform public.member_pin_audit(v_member, v_had, true);

  if v_generated then
    return jsonb_build_object('result', 'ok', 'pin', v_pin);
  end if;
  return jsonb_build_object('result', 'ok');
end;
$$;

create or replace function public.clear_member_pin(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members%rowtype;
  v_n integer;
begin
  v_member := public.member_pin_authorize(p_member_id);
  delete from public.member_pins where member_id = p_member_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform public.member_pin_audit(v_member, true, false);
  end if;
  return jsonb_build_object('result', 'ok', 'had_pin', v_n > 0);
end;
$$;

create or replace function public.member_pin_status(p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.member_pins%rowtype;
begin
  perform public.member_pin_authorize(p_member_id);
  select * into v_row from public.member_pins where member_id = p_member_id;
  if not found then
    return jsonb_build_object('has_pin', false, 'locked_until', null, 'set_at', null);
  end if;
  return jsonb_build_object(
    'has_pin', true,
    'locked_until', case when v_row.locked_until > now() then v_row.locked_until end,
    'set_at', v_row.set_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Member side.
create or replace function public.my_card()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member uuid := public.jwt_member_id();
  v_card record;
begin
  if v_member is null then
    raise exception 'Members only' using errcode = 'insufficient_privilege';
  end if;

  select cs.card_no, mc.assigned_at into v_card
  from public.member_cards mc
  join public.card_stock cs on cs.org_id = mc.org_id and cs.card_uid = mc.card_uid
  where mc.member_id = v_member and mc.revoked_at is null
  order by mc.assigned_at desc
  limit 1;

  if not found then
    return jsonb_build_object('card_no', null, 'card_no_text', null, 'assigned_at', null);
  end if;
  return jsonb_build_object(
    'card_no', v_card.card_no,
    'card_no_text', public.format_card_no(v_card.card_no),
    'assigned_at', v_card.assigned_at
  );
end;
$$;

-- Shared by request_renewal; same rules as public_renewal_request (one pending
-- row per member, 10 minutes between repeats, 30 new requests per org per hour).
create or replace function public.file_renewal_request(
  p_org_id uuid,
  p_member_id uuid,
  p_stock_id uuid,
  p_phone text,
  p_note text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := nullif(left(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), 20), '');
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  v_row public.renewal_requests%rowtype;
  v_recent integer;
begin
  select * into v_row from public.renewal_requests r
  where r.member_id = p_member_id and r.status = 'pending'::public.renewal_request_status
  for update;

  if not found then
    select count(*) into v_recent from public.renewal_requests r
    where r.org_id = p_org_id and r.requested_at > now() - interval '1 hour';
    if v_recent >= 30 then
      return 'too_soon';
    end if;

    insert into public.renewal_requests (org_id, member_id, card_stock_id, phone, note)
    values (p_org_id, p_member_id, p_stock_id, v_phone, v_note)
    on conflict (member_id) where status = 'pending'::public.renewal_request_status do nothing;
    if found then
      return 'ok';
    end if;

    select * into v_row from public.renewal_requests r
    where r.member_id = p_member_id and r.status = 'pending'::public.renewal_request_status
    for update;
  end if;

  if v_row.last_requested_at > now() - interval '10 minutes' then
    return 'too_soon';
  end if;

  update public.renewal_requests r
  set request_count = r.request_count + 1,
      last_requested_at = now(),
      phone = coalesce(r.phone, v_phone),
      note = coalesce(r.note, v_note),
      card_stock_id = coalesce(r.card_stock_id, p_stock_id)
  where r.id = v_row.id;
  return 'ok';
end;
$$;

create or replace function public.request_renewal(p_phone text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members%rowtype;
  v_stock uuid;
begin
  if public.jwt_member_id() is null then
    raise exception 'Members only' using errcode = 'insufficient_privilege';
  end if;

  select * into v_member from public.members m
  where m.id = public.jwt_member_id()
    and m.archived_at is null
    and m.status <> 'left'::public.member_status;
  if not found then
    return jsonb_build_object('result', 'no_member');
  end if;

  select cs.id into v_stock
  from public.member_cards mc
  join public.card_stock cs on cs.org_id = mc.org_id and cs.card_uid = mc.card_uid
  where mc.member_id = v_member.id and mc.revoked_at is null
  order by mc.assigned_at desc
  limit 1;

  return jsonb_build_object(
    'result',
    public.file_renewal_request(v_member.org_id, v_member.id, v_stock, p_phone, p_note)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants.
revoke all on function public.verify_member_pin(uuid, text) from public, anon, authenticated;
revoke all on function public.member_login_lookup(text, text) from public, anon, authenticated;
revoke all on function public.member_pin_authorize(uuid) from public, anon, authenticated;
revoke all on function public.member_pin_audit(public.members, boolean, boolean) from public, anon, authenticated;
revoke all on function public.file_renewal_request(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.verify_member_pin(uuid, text) to service_role;
grant execute on function public.member_login_lookup(text, text) to service_role;

revoke all on function public.set_member_pin(uuid, text) from public, anon;
revoke all on function public.clear_member_pin(uuid) from public, anon;
revoke all on function public.member_pin_status(uuid) from public, anon;
revoke all on function public.my_card() from public, anon;
revoke all on function public.request_renewal(text, text) from public, anon;
grant execute on function public.set_member_pin(uuid, text) to authenticated;
grant execute on function public.clear_member_pin(uuid) to authenticated;
grant execute on function public.member_pin_status(uuid) to authenticated;
grant execute on function public.my_card() to authenticated;
grant execute on function public.request_renewal(text, text) to authenticated;
