-- Door-display QR check-in (backend).
--
-- The door reader's OLED shows a QR that rotates every 30 s. A member scans it
-- with the app, the app calls member_door_check_in(payload), the server checks
-- the code, runs the SAME allow/deny rules a card tap runs, records attendance
-- (method 'qr') and queues an unlock request. The reader polls rfid-poll and
-- opens the relay when it finds one.
--
--   payload  = 'LG1.<qr_id>.<8 digits>'
--   code     = lpad((first 4 bytes of HMAC-SHA256(secret, '<qr_id>:<window>'),
--                    big-endian uint32, mod 100000000)::text, 8, '0')
--   window   = floor(unix_epoch_seconds / 30); the server accepts window-1..+1
--
-- Where the secret lives: NOT on devices. A staff-readable devices row is
-- returned by update_device() (to_jsonb(row) - 'key_hash'), granted wholesale
-- to authenticated and copied into audit_log by audit_row on insert; any of
-- those would hand a front-desk user the means to forge codes. The per-device
-- secret is in device_qr_secrets (RLS on, no policy, no client grants), read
-- only by security definer functions. devices only gains the public qr_id.
--
-- rfid_check_in is refactored: the member half (snapshot -> allow/deny ->
-- attendance insert) moves into door_member_tap(), which both the card path
-- and member_door_check_in call. Card behaviour is unchanged; staff_cards.sql,
-- rfid_check_in.sql and rfid_offline_sync.sql re-run green.

-- ---------------------------------------------------------------------------
-- devices.qr_id -- small per-org number printed into the QR payload.

alter table public.devices add column qr_id integer;

update public.devices d
set qr_id = n.rn
from (
  select id, row_number() over (partition by org_id order by created_at, id)::integer as rn
  from public.devices
) n
where n.id = d.id;

alter table public.devices
  alter column qr_id set not null,
  add constraint devices_qr_id_range check (qr_id between 1 and 999999),
  add constraint devices_org_id_qr_id_key unique (org_id, qr_id);

comment on column public.devices.qr_id is
  'Per-org number carried in the door QR payload (LG1.<qr_id>.<code>). Auto-assigned on insert. Not a secret.';

-- New rows get the next free number in their org. The advisory lock keeps two
-- concurrent registrations in one org from picking the same number.
create or replace function public.devices_assign_qr_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.qr_id is null then
    perform pg_advisory_xact_lock(hashtextextended('devices_qr_id:' || new.org_id::text, 0));
    select coalesce(max(d.qr_id), 0) + 1 into new.qr_id
    from public.devices d
    where d.org_id = new.org_id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- device_qr_secrets -- 32 random bytes per device. Service/definer only.

create table public.device_qr_secrets (
  device_id uuid primary key references public.devices (id) on delete cascade,
  org_id uuid not null references public.orgs (id) on delete cascade,
  qr_secret bytea not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  constraint device_qr_secrets_len check (length(qr_secret) = 32)
);

alter table public.device_qr_secrets enable row level security;
revoke all on public.device_qr_secrets from public, anon, authenticated;

comment on table public.device_qr_secrets is
  'HMAC secret for each reader''s rotating door QR. RLS on with no policies: only security definer functions (and service_role) touch it. Never select it from a client path.';

insert into public.device_qr_secrets (device_id, org_id, qr_secret)
select d.id, d.org_id, extensions.gen_random_bytes(32)
from public.devices d;

create or replace function public.devices_create_qr_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.device_qr_secrets (device_id, org_id, qr_secret)
  values (new.id, new.org_id, extensions.gen_random_bytes(32));
  return new;
end;
$$;

create trigger devices_assign_qr_id
  before insert on public.devices
  for each row execute function public.devices_assign_qr_id();
create trigger devices_create_qr_secret
  after insert on public.devices
  for each row execute function public.devices_create_qr_secret();

revoke execute on function public.devices_assign_qr_id() from public, anon, authenticated, service_role;
revoke execute on function public.devices_create_qr_secret() from public, anon, authenticated, service_role;

-- rotate_device_key also rotates the QR secret: a leaked reader credential
-- should not leave a forgeable QR behind. (The reader refetches the secret
-- from rfid-sync when it is reflashed with the new key.)
create or replace function public.rotate_device_key(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.devices%rowtype;
  v_key text;
begin
  select * into v_device
  from public.devices d
  where d.id = p_device_id and d.org_id = public.jwt_org_id();

  if not found or not public.has_branch_access(v_device.branch_id) then
    raise exception 'Device not found' using errcode = 'no_data_found';
  end if;

  if public.jwt_staff_id() is null
     or not (
       public.jwt_is_owner()
       or public.jwt_staff_role() = 'manager'::public.staff_role
     )
  then
    raise exception 'Only an owner or manager can rotate a device key'
      using errcode = 'insufficient_privilege';
  end if;

  v_key := public.new_device_key();

  update public.devices d
  set key_hash = encode(extensions.digest(v_key, 'sha256'), 'hex'),
      key_prefix = left(v_key, 8)
  where d.id = v_device.id;

  insert into public.device_qr_secrets (device_id, org_id, qr_secret, rotated_at)
  values (v_device.id, v_device.org_id, extensions.gen_random_bytes(32), now())
  on conflict (device_id) do update
  set qr_secret = excluded.qr_secret, rotated_at = now();

  return jsonb_build_object('device_id', v_device.id, 'key', v_key);
end;
$$;

-- ---------------------------------------------------------------------------
-- door_qr_code -- the shared definition of the rotating code. Test vector:
--   secret = 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f (hex)
--   qr_id = 7, window = 56789012  -> message '7:56789012'  -> code '06036629'

create or replace function public.door_qr_code(p_secret bytea, p_qr_id integer, p_window bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select lpad(
    ((
      (get_byte(h, 0)::bigint << 24)
      | (get_byte(h, 1)::bigint << 16)
      | (get_byte(h, 2)::bigint << 8)
      | get_byte(h, 3)::bigint
    ) % 100000000)::text,
    8, '0')
  from (
    select extensions.hmac(
      convert_to(p_qr_id::text || ':' || p_window::text, 'UTF8'),
      p_secret,
      'sha256'
    ) as h
  ) x;
$$;

-- ---------------------------------------------------------------------------
-- Unlock requests + failure log (RLS on, no client policies).

create table public.device_unlock_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  device_id uuid not null references public.devices (id) on delete cascade,
  member_id uuid not null,
  attendance_id uuid,
  display jsonb not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  constraint device_unlock_requests_member_fkey
    foreign key (member_id, org_id) references public.members (id, org_id) on delete cascade,
  constraint device_unlock_requests_attendance_fkey
    foreign key (attendance_id, org_id) references public.attendance (id, org_id)
    on delete set null (attendance_id)
);

create index device_unlock_requests_pending_idx
  on public.device_unlock_requests (device_id, created_at desc)
  where consumed_at is null;
create index device_unlock_requests_member_idx
  on public.device_unlock_requests (member_id);
create index device_unlock_requests_org_idx
  on public.device_unlock_requests (org_id);

alter table public.device_unlock_requests enable row level security;
revoke all on public.device_unlock_requests from public, anon, authenticated;

comment on table public.device_unlock_requests is
  'A member''s valid door-QR scan waiting for the reader to poll it (rfid_poll_unlock consumes the newest one younger than 20 s). Internal: RLS on, no client policies.';

create table public.door_qr_failures (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  member_id uuid not null,
  failed_at timestamptz not null default now(),
  constraint door_qr_failures_member_fkey
    foreign key (member_id, org_id) references public.members (id, org_id) on delete cascade
);

create index door_qr_failures_member_idx on public.door_qr_failures (member_id, failed_at desc);
create index door_qr_failures_org_idx on public.door_qr_failures (org_id);

alter table public.door_qr_failures enable row level security;
revoke all on public.door_qr_failures from public, anon, authenticated;

comment on table public.door_qr_failures is
  'Bad door-QR attempts per member, for the 10-per-10-minutes throttle in member_door_check_in. Internal: RLS on, no client policies.';

-- ---------------------------------------------------------------------------
-- door_member_tap -- the member half of rfid_check_in, extracted unchanged.
-- Snapshot -> allow/deny -> (first allowed visit of the day) attendance insert.
-- p_method is 'card' for the reader and 'qr' for member_door_check_in.

create or replace function public.door_member_tap(
  p_device_id uuid,
  p_member_id uuid,
  p_method public.attendance_method
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device record;
  v_member public.members%rowtype;
  v_snap record;
  v_banner text;
  v_allowed boolean;
  v_reason text;
  v_today date;
  v_existing_id uuid;
  v_attendance_id uuid;
begin
  select d.id, d.org_id, d.branch_id, d.name, b.name as branch_name
    into v_device
  from public.devices d
  join public.branches b on b.id = d.branch_id
  where d.id = p_device_id;

  select m.* into v_member
  from public.members m
  where m.id = p_member_id and m.org_id = v_device.org_id;

  select * into v_snap from public.attendance_snapshot(v_member.id);
  v_banner := case when v_member.archived_at is not null then 'left' else v_snap.banner end;

  v_allowed := v_banner in ('active', 'expiring') and coalesce(v_snap.due_paisa, 0) = 0;
  v_reason := case when coalesce(v_snap.due_paisa, 0) > 0 then 'dues' else v_banner end;

  v_today := public.org_today(v_device.org_id);

  select a.id into v_existing_id
  from public.attendance a
  where a.member_id = v_member.id and a.attended_on = v_today
  order by a.checked_in_at desc
  limit 1;

  if v_allowed and v_existing_id is null then
    begin
      insert into public.attendance (
        org_id, branch_id, member_id, membership_id, method,
        checked_in_at, attended_on,
        membership_status_at_checkin, days_to_expiry_at_checkin, due_paisa_at_checkin,
        checked_in_by, device_id
      )
      values (
        v_device.org_id, v_device.branch_id, v_member.id, v_snap.membership_id,
        p_method,
        now(), v_today,
        v_snap.membership_status, v_snap.days_to_expiry, coalesce(v_snap.due_paisa, 0),
        null, v_device.id
      )
      returning id into v_attendance_id;
    exception when unique_violation then
      select a.id into v_existing_id
      from public.attendance a
      where a.member_id = v_member.id and a.attended_on = v_today
      order by a.checked_in_at desc
      limit 1;
    end;
  end if;

  return jsonb_build_object(
    'decision', case when v_allowed then 'allow' else 'deny' end,
    'reason', v_reason,
    'member_name', v_member.full_name,
    'member_code', v_member.member_code,
    'status', v_banner,
    'days_to_expiry', v_snap.days_to_expiry,
    'due_paisa', coalesce(v_snap.due_paisa, 0),
    'already_checked_in_today', v_existing_id is not null,
    'attendance_id', coalesce(v_attendance_id, v_existing_id),
    'branch_name', v_device.branch_name,
    'device_name', v_device.name
  );
end;
$$;

revoke execute on function public.door_member_tap(uuid, uuid, public.attendance_method)
  from public, anon, authenticated, service_role;

-- rfid_check_in: identical to before except the member tail now calls the helper.
create or replace function public.rfid_check_in(
  p_key_hash text,
  p_card_uid text,
  p_scanned_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device record;
  v_uid text;
  v_member public.members%rowtype;
  v_staff public.staff%rowtype;
  v_tap jsonb;
  v_clock text;
begin
  select d.id, d.org_id, d.branch_id, d.name, d.status, b.name as branch_name
    into v_device
  from public.devices d
  join public.branches b on b.id = d.branch_id
  where d.key_hash = p_key_hash;

  if not found then
    return jsonb_build_object('decision', 'deny', 'reason', 'device_unknown');
  end if;

  if v_device.status = 'disabled'::public.device_status then
    return jsonb_build_object(
      'decision', 'deny', 'reason', 'device_disabled',
      'device_name', v_device.name, 'branch_name', v_device.branch_name
    );
  end if;

  update public.devices d set last_seen_at = now() where d.id = v_device.id;

  v_uid := public.normalize_card_uid(p_card_uid);
  if v_uid !~ '^[0-9A-F]{8,20}$' then
    return jsonb_build_object(
      'decision', 'deny', 'reason', 'bad_uid',
      'device_name', v_device.name, 'branch_name', v_device.branch_name
    );
  end if;

  select s.* into v_staff
  from public.staff_cards sc
  join public.staff s on s.id = sc.staff_id and s.org_id = sc.org_id
  where sc.org_id = v_device.org_id
    and sc.card_uid = v_uid
    and sc.revoked_at is null;

  if found then
    if v_staff.status <> 'active'::public.staff_status then
      return jsonb_build_object(
        'decision', 'deny', 'reason', 'staff_inactive',
        'member_name', v_staff.full_name, 'member_code', 'STAFF',
        'status', 'staff',
        'branch_name', v_device.branch_name, 'device_name', v_device.name
      );
    end if;

    if v_staff.role <> 'owner'::public.staff_role
       and not (v_device.branch_id = any (v_staff.branch_ids)) then
      return jsonb_build_object(
        'decision', 'deny', 'reason', 'staff_wrong_branch',
        'member_name', v_staff.full_name, 'member_code', 'STAFF',
        'status', 'staff',
        'branch_name', v_device.branch_name, 'device_name', v_device.name
      );
    end if;

    v_tap := public.staff_clock_tap(
      v_device.org_id, v_device.branch_id, v_device.id, v_staff.id, 'card'
    );
    v_clock := v_tap ->> 'clock';

    return jsonb_build_object(
      'decision', 'allow',
      'reason', case v_clock
        when 'in' then 'staff_in'
        when 'out' then 'staff_out'
        else 'staff_already_in'
      end,
      'member_name', v_staff.full_name,
      'member_code', 'STAFF',
      'status', 'staff',
      'days_to_expiry', null,
      'due_paisa', 0,
      'already_checked_in_today', v_clock = 'already_in',
      'attendance_id', v_tap ->> 'attendance_id',
      'kind', 'staff',
      'clock', v_clock,
      'at', v_tap ->> 'at',
      'branch_name', v_device.branch_name,
      'device_name', v_device.name
    );
  end if;

  select m.* into v_member
  from public.member_cards mc
  join public.members m on m.id = mc.member_id
  where mc.org_id = v_device.org_id
    and mc.card_uid = v_uid
    and mc.revoked_at is null;

  if not found then
    insert into public.unassigned_card_scans (
      org_id, branch_id, device_id, card_uid, first_seen_at, last_seen_at, scan_count
    )
    values (
      v_device.org_id, v_device.branch_id, v_device.id, v_uid, now(), now(), 1
    )
    on conflict (device_id, card_uid) do update
    set last_seen_at = now(),
        branch_id = excluded.branch_id,
        scan_count = public.unassigned_card_scans.scan_count + 1;

    delete from public.unassigned_card_scans s
    where s.device_id = v_device.id
      and s.last_seen_at < now() - interval '7 days';

    return jsonb_build_object(
      'decision', 'deny', 'reason', 'unknown_card',
      'device_name', v_device.name, 'branch_name', v_device.branch_name
    );
  end if;

  return public.door_member_tap(v_device.id, v_member.id, 'card'::public.attendance_method);
end;
$$;

-- ---------------------------------------------------------------------------
-- member_door_check_in -- the member's scan.

create or replace function public.member_door_check_in(p_payload text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid := public.jwt_member_id();
  v_member public.members%rowtype;
  v_parts text[];
  v_qr_id integer;
  v_code text;
  v_device record;
  v_secret bytea;
  v_window bigint := floor(extract(epoch from now()) / 30);
  v_ok boolean := false;
  v_tz text;
  v_local time;
  v_open boolean;
  v_tap jsonb;
  v_fails integer;
begin
  if v_member_id is null then
    raise exception 'Only a member can scan the door code'
      using errcode = 'insufficient_privilege';
  end if;

  select m.* into v_member from public.members m where m.id = v_member_id;
  if not found then
    raise exception 'Only a member can scan the door code'
      using errcode = 'insufficient_privilege';
  end if;

  -- throttle: 10 bad codes in 10 minutes
  select count(*) into v_fails
  from public.door_qr_failures f
  where f.member_id = v_member.id and f.failed_at > now() - interval '10 minutes';
  if v_fails >= 10 then
    return jsonb_build_object('result', 'rate_limited', 'reason', 'too_many_bad_codes');
  end if;

  v_parts := regexp_match(coalesce(p_payload, ''), '^LG1\.([0-9]{1,6})\.([0-9]{8})$');
  if v_parts is not null then
    v_qr_id := v_parts[1]::integer;
    v_code := v_parts[2];

    select d.id, d.org_id, d.branch_id, d.name, d.status, b.name as branch_name,
           b.opens_at, b.closes_at
      into v_device
    from public.devices d
    join public.branches b on b.id = d.branch_id
    where d.org_id = v_member.org_id and d.qr_id = v_qr_id;

    if found then
      select s.qr_secret into v_secret
      from public.device_qr_secrets s where s.device_id = v_device.id;
      if v_secret is not null then
        v_ok := v_code in (
          public.door_qr_code(v_secret, v_qr_id, v_window),
          public.door_qr_code(v_secret, v_qr_id, v_window - 1),
          public.door_qr_code(v_secret, v_qr_id, v_window + 1)
        );
      end if;
    end if;
  end if;

  if not v_ok then
    insert into public.door_qr_failures (org_id, member_id)
    values (v_member.org_id, v_member.id);
    delete from public.door_qr_failures f
    where f.member_id = v_member.id and f.failed_at < now() - interval '1 hour';
    return jsonb_build_object('result', 'invalid_code', 'member_name', v_member.full_name);
  end if;

  if v_device.status <> 'active'::public.device_status then
    return jsonb_build_object(
      'result', 'closed', 'reason', 'device_disabled',
      'member_name', v_member.full_name, 'branch_name', v_device.branch_name
    );
  end if;

  -- opening hours in the org's timezone; both null = always open, one null =
  -- unbounded on that side, opens_at > closes_at = overnight.
  select coalesce(o.timezone, 'Asia/Kathmandu') into v_tz
  from public.orgs o where o.id = v_member.org_id;
  v_local := (now() at time zone coalesce(v_tz, 'Asia/Kathmandu'))::time;
  v_open := case
    when v_device.opens_at is null and v_device.closes_at is null then true
    when v_device.opens_at is null then v_local <= v_device.closes_at
    when v_device.closes_at is null then v_local >= v_device.opens_at
    when v_device.opens_at <= v_device.closes_at
      then v_local >= v_device.opens_at and v_local <= v_device.closes_at
    else v_local >= v_device.opens_at or v_local <= v_device.closes_at
  end;
  if not v_open then
    return jsonb_build_object(
      'result', 'closed', 'reason', 'outside_hours',
      'member_name', v_member.full_name, 'branch_name', v_device.branch_name,
      'opens_at', to_char(v_device.opens_at, 'HH24:MI'),
      'closes_at', to_char(v_device.closes_at, 'HH24:MI')
    );
  end if;

  v_tap := public.door_member_tap(v_device.id, v_member.id, 'qr'::public.attendance_method);

  if v_tap ->> 'decision' = 'allow' then
    insert into public.device_unlock_requests (
      org_id, device_id, member_id, attendance_id, display
    )
    values (
      v_member.org_id, v_device.id, v_member.id,
      (v_tap ->> 'attendance_id')::uuid,
      jsonb_build_object(
        'member_name', v_tap -> 'member_name',
        'member_code', v_tap -> 'member_code',
        'days_to_expiry', v_tap -> 'days_to_expiry',
        'status', v_tap -> 'status'
      )
    );
    delete from public.device_unlock_requests r
    where r.device_id = v_device.id and r.created_at < now() - interval '1 day';
  end if;

  return jsonb_build_object(
    'result', case when v_tap ->> 'decision' = 'allow' then 'ok' else 'denied' end,
    'reason', case when v_tap ->> 'decision' = 'allow' then null else v_tap ->> 'reason' end,
    'member_name', v_tap -> 'member_name',
    'days_to_expiry', v_tap -> 'days_to_expiry',
    'due_paisa', v_tap -> 'due_paisa',
    'already_checked_in_today', v_tap -> 'already_checked_in_today',
    'status', v_tap -> 'status',
    'branch_name', v_tap -> 'branch_name'
  );
end;
$$;

revoke execute on function public.member_door_check_in(text) from public, anon;
grant execute on function public.member_door_check_in(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reader-side RPCs (service_role only; the Edge Functions hash the key).

create or replace function public.rfid_poll_unlock(p_key_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device record;
  v_display jsonb;
begin
  select d.id, d.status into v_device
  from public.devices d where d.key_hash = p_key_hash;

  if not found then
    return jsonb_build_object('decision', 'deny', 'reason', 'device_unknown');
  end if;
  if v_device.status = 'disabled'::public.device_status then
    return jsonb_build_object('decision', 'deny', 'reason', 'device_disabled');
  end if;

  -- polled about once a second: only touch the row twice a minute
  update public.devices d set last_seen_at = now()
  where d.id = v_device.id
    and (d.last_seen_at is null or d.last_seen_at < now() - interval '30 seconds');

  -- Consume every fresh unconsumed request for this reader (so one scan opens
  -- the door once) and answer with the newest one's display fields. Requests
  -- older than 20 s are never honoured: a late scan must not open the door.
  with fresh as (
    select r.id, r.display, r.created_at
    from public.device_unlock_requests r
    where r.device_id = v_device.id
      and r.consumed_at is null
      and r.created_at > now() - interval '20 seconds'
    order by r.created_at desc
    for update skip locked
  ), used as (
    update public.device_unlock_requests r
    set consumed_at = now()
    from fresh f
    where r.id = f.id
    returning f.display, f.created_at
  )
  select u.display into v_display from used u order by u.created_at desc limit 1;

  return jsonb_build_object(
    'decision', 'ok',
    'unlock', v_display,
    'server_time', floor(extract(epoch from now()))::bigint
  );
end;
$$;

create or replace function public.rfid_qr_config(p_key_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device record;
  v_secret bytea;
begin
  select d.id, d.status, d.qr_id into v_device
  from public.devices d where d.key_hash = p_key_hash;

  if not found then
    return jsonb_build_object('decision', 'deny', 'reason', 'device_unknown');
  end if;
  if v_device.status = 'disabled'::public.device_status then
    return jsonb_build_object('decision', 'deny', 'reason', 'device_disabled');
  end if;

  select s.qr_secret into v_secret
  from public.device_qr_secrets s where s.device_id = v_device.id;

  update public.devices d set last_seen_at = now() where d.id = v_device.id;

  return jsonb_build_object(
    'decision', 'ok',
    'qr', jsonb_build_object(
      'qr_id', v_device.qr_id,
      'secret_b64', encode(v_secret, 'base64')
    ),
    'server_time', floor(extract(epoch from now()))::bigint
  );
end;
$$;

revoke execute on function public.rfid_poll_unlock(text) from public, anon, authenticated;
revoke execute on function public.rfid_qr_config(text) from public, anon, authenticated;
grant execute on function public.rfid_poll_unlock(text) to service_role;
grant execute on function public.rfid_qr_config(text) to service_role;

revoke execute on function public.door_qr_code(bytea, integer, bigint) from public, anon, authenticated;
grant execute on function public.door_qr_code(bytea, integer, bigint) to service_role;
