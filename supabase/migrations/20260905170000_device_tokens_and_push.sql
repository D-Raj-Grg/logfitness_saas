-- Phase 6 -- Push notification substrate. A device_tokens table keyed to
-- exactly one principal (member or staff, never both), the RPCs that
-- register and revoke a token for the calling principal, and a push_log
-- table the fanout Edge Function writes to.
--
-- device_tokens rows are device identifiers, not business data: staff can
-- see which of their own devices are registered, but never a member's --
-- there is no legitimate business reason for the front desk to read a
-- member's push token, and every leak of a device identifier is a leak of
-- exactly the kind RLS exists to prevent. So this table gets member/staff
-- self-read policies only, no "staff read in their org" policy at all.

create type public.device_platform as enum ('ios', 'android');

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  member_id uuid references public.members (id) on delete cascade,
  staff_id uuid references public.staff (id) on delete cascade,
  token text not null,
  platform public.device_platform not null,
  app_version text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint device_tokens_one_owner check (
    (member_id is not null and staff_id is null)
    or (member_id is null and staff_id is not null)
  ),
  -- A token belongs to exactly one row. A device that gets handed to another
  -- person must move (see register_device_token), not duplicate.
  constraint device_tokens_token_key unique (token),
  constraint device_tokens_member_id_org_id_fkey
    foreign key (member_id, org_id) references public.members (id, org_id) on delete cascade,
  constraint device_tokens_staff_id_org_id_fkey
    foreign key (staff_id, org_id) references public.staff (id, org_id) on delete cascade
);

create index device_tokens_member_id_idx on public.device_tokens (member_id) where member_id is not null;
create index device_tokens_staff_id_idx on public.device_tokens (staff_id) where staff_id is not null;
-- The fanout query's hot path: live (unrevoked) tokens for a set of members
-- in one org.
create index device_tokens_org_live_idx
  on public.device_tokens (org_id, member_id)
  where revoked_at is null;

create trigger device_tokens_set_updated_at
  before update on public.device_tokens
  for each row execute function public.set_updated_at();

comment on table public.device_tokens is
  'Push notification device tokens, one row per physical device. RLS scopes reads to the owning principal only -- staff do not get to read members'' tokens, because they are device identifiers, not business data.';
comment on column public.device_tokens.token is
  'Opaque FCM registration token. Never logged or returned in an error path.';

alter table public.device_tokens enable row level security;

create policy "members read their own device tokens"
  on public.device_tokens for select to authenticated
  using (public.jwt_is_member() and member_id = public.jwt_member_id());

create policy "staff read their own device tokens"
  on public.device_tokens for select to authenticated
  using (public.jwt_is_staff() and staff_id = public.jwt_staff_id());

-- No insert/update/delete policies for either principal: tokens are written
-- only through register_device_token / revoke_device_token below, both
-- security definer. A direct write policy here would let a member (or a
-- compromised client) point a token at someone else's member_id.

-- ---------------------------------------------------------------------------
-- push_log -- one row per send attempt, written by the push-fanout Edge
-- Function using the service-role key. Readable by owners and managers only:
-- it is diagnostic data about notification delivery, not something a
-- front-desk or trainer role needs.

create table public.push_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  member_id uuid references public.members (id) on delete set null,
  device_token_id uuid references public.device_tokens (id) on delete set null,
  title text not null,
  status text not null,
  error text,
  created_at timestamptz not null default now(),
  constraint push_log_member_id_org_id_fkey
    foreign key (member_id, org_id) references public.members (id, org_id) on delete set null
);

create index push_log_org_id_idx on public.push_log (org_id, created_at desc);

comment on table public.push_log is
  'Send-attempt log written by the push-fanout Edge Function via the service-role key. Readable by owners and managers only.';

alter table public.push_log enable row level security;

create policy "owners and managers read push log"
  on public.push_log for select to authenticated
  using (
    public.is_org_member(org_id)
    and public.jwt_is_staff()
    and (public.jwt_is_owner() or public.jwt_staff_role() = 'manager'::public.staff_role)
  );

-- No write policies: only the service-role key (which bypasses RLS) writes
-- push_log, from inside the Edge Function.

-- ---------------------------------------------------------------------------
-- RPCs, security definer and style-matched to link_member_account(): the
-- calling principal has no row-level access path of their own into a table
-- keyed by someone else's id, so the definer function reads auth.uid()/the
-- JWT claims itself and does the single scoped write.

create or replace function public.register_device_token(
  p_token text,
  p_platform text,
  p_app_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := public.jwt_org_id();
  v_member_id uuid := public.jwt_member_id();
  v_staff_id uuid := public.jwt_staff_id();
  v_platform public.device_platform;
  v_id uuid;
begin
  if v_org_id is null or (v_member_id is null and v_staff_id is null) then
    raise exception 'Not authenticated as a member or staff principal'
      using errcode = 'insufficient_privilege';
  end if;

  if p_token is null or btrim(p_token) = '' then
    raise exception 'A device token is required' using errcode = 'check_violation';
  end if;

  begin
    v_platform := p_platform::public.device_platform;
  exception when invalid_text_representation then
    raise exception 'Unknown platform %', p_platform using errcode = 'check_violation';
  end;

  -- Upsert on the token, re-pointing it to the calling principal if it
  -- previously belonged to someone else (a device handed to a new person)
  -- and clearing any prior revocation, since this is a live registration.
  insert into public.device_tokens (
    org_id, member_id, staff_id, token, platform, app_version,
    last_seen_at, revoked_at
  )
  values (
    v_org_id, v_member_id, v_staff_id, p_token, v_platform, p_app_version,
    now(), null
  )
  on conflict (token) do update
  set org_id = excluded.org_id,
      member_id = excluded.member_id,
      staff_id = excluded.staff_id,
      platform = excluded.platform,
      app_version = excluded.app_version,
      last_seen_at = now(),
      revoked_at = null
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.revoke_device_token(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid := public.jwt_member_id();
  v_staff_id uuid := public.jwt_staff_id();
  v_updated int;
begin
  if v_member_id is null and v_staff_id is null then
    raise exception 'Not authenticated as a member or staff principal'
      using errcode = 'insufficient_privilege';
  end if;

  -- Soft-revoke only, and only the caller's own token: never deletes, so a
  -- stale token can still be diagnosed later, and never touches a row that
  -- belongs to someone else.
  update public.device_tokens
  set revoked_at = now()
  where token = p_token
    and revoked_at is null
    and (
      (v_member_id is not null and member_id = v_member_id)
      or (v_staff_id is not null and staff_id = v_staff_id)
    );

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    -- Either the token does not exist, already revoked, or belongs to
    -- someone else. Indistinguishable by design -- same as invite_member().
    raise exception 'Device token not found' using errcode = 'no_data_found';
  end if;
end;
$$;

-- Grant hygiene: Postgres grants EXECUTE on new functions to public by
-- default, and Supabase exposes public/anon over PostgREST.
revoke execute on function public.register_device_token(text, text, text) from public, anon;
revoke execute on function public.revoke_device_token(text) from public, anon;

grant execute on function public.register_device_token(text, text, text) to authenticated;
grant execute on function public.revoke_device_token(text) to authenticated;
