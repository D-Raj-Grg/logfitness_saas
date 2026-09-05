-- Phase 6 -- Member app authentication. Members become a second principal type:
-- staff invite them by email, accepting the invitation links the auth user to
-- the existing members row, and the access-token hook then stamps a member
-- claim set so RLS can scope every read to that one member.
--
-- This mirrors the staff invite/link flow deliberately (staff.invited_at /
-- accepted_at, link_staff_account, current_staff) so there is one shape to
-- reason about, not two.

alter table public.members
  add column if not exists invited_by uuid,
  add column if not exists invited_at timestamptz,
  add column if not exists accepted_at timestamptz;

alter table public.members
  add constraint members_invited_by_fkey
    foreign key (invited_by, org_id)
    references public.staff (id, org_id) on delete set null;

-- An invitation is sent to an email address, so there has to be one.
alter table public.members
  add constraint members_invite_needs_email
    check (invited_at is null or email is not null);

-- Acceptance without an invitation would mean an account linked itself.
alter table public.members
  add constraint members_accept_requires_invite
    check (accepted_at is null or invited_at is not null);

-- Two members in one org cannot share an email address, or the link step below
-- could not tell which record the account belongs to. Nulls are unconstrained:
-- most members never get app access.
create unique index if not exists members_org_email_key
  on public.members (org_id, lower(email))
  where email is not null;

comment on column public.members.invited_at is
  'Set when staff invite this member to the mobile app. Null means the member is a record in the system, not a user of it.';
comment on column public.members.accepted_at is
  'Set by link_member_account() when the invited account signs in and adopts this row.';

-- Claim readers for the member principal, alongside the staff ones.

create or replace function public.jwt_member_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(public.jwt_claims() ->> 'member_id', '')::uuid;
$$;

create or replace function public.jwt_is_member()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.jwt_claims() ->> 'role' = 'member'
     and public.jwt_member_id() is not null;
$$;

-- Invites a member to the app. Runs as the caller, so the existing member RLS
-- update policy decides whether this staff member may touch the row, and the
-- audit trigger records the change like any other edit.
create or replace function public.invite_member(
  p_member_id uuid,
  p_email text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_member public.members;
begin
  if v_email is null or position('@' in v_email) < 2 then
    raise exception 'A valid email address is required to invite a member'
      using errcode = 'check_violation';
  end if;

  select * into v_member from public.members where id = p_member_id;

  if v_member.id is null then
    -- Either the member does not exist or RLS hides it. Indistinguishable by
    -- design.
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;

  if v_member.auth_user_id is not null then
    raise exception 'That member already has an app account'
      using errcode = 'unique_violation';
  end if;

  update public.members
  set email = v_email,
      invited_by = (select st.id from public.staff st where st.auth_user_id = auth.uid()),
      invited_at = now()
  where id = p_member_id;

  return p_member_id;
end;
$$;

-- Adopts a pending invitation for the signed-in account. Security definer
-- because the caller has no claims yet -- that is the whole point of this call
-- -- so no RLS policy could let them find their own row.
create or replace function public.link_member_account()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_member_id uuid;
  v_pending int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Already linked: idempotent, and never re-points an existing link.
  select id into v_member_id from public.members where auth_user_id = v_user_id;
  if v_member_id is not null then
    return v_member_id;
  end if;

  select lower(email) into v_email from auth.users where id = v_user_id;
  if v_email is null then
    raise exception 'Account has no email address' using errcode = 'check_violation';
  end if;

  select count(*) into v_pending
  from public.members m
  join public.orgs o on o.id = m.org_id
  where lower(m.email) = v_email
    and m.auth_user_id is null
    and m.invited_at is not null
    and m.status <> 'left'::public.member_status
    and o.status = 'active'::public.org_status;

  -- One email invited by two different gyms. Resolving it silently would pick a
  -- tenant at random, so refuse and let staff sort it out.
  if v_pending > 1 then
    raise exception 'That email address is invited at more than one gym'
      using errcode = 'cardinality_violation';
  end if;

  update public.members m
  set auth_user_id = v_user_id,
      accepted_at = now()
  from public.orgs o
  where o.id = m.org_id
    and lower(m.email) = v_email
    and m.auth_user_id is null
    and m.invited_at is not null
    and m.status <> 'left'::public.member_status
    and o.status = 'active'::public.org_status
  returning m.id into v_member_id;

  if v_member_id is null then
    raise exception 'No pending invitation for this email address'
      using errcode = 'no_data_found';
  end if;

  return v_member_id;
end;
$$;

-- The member-side analogue of current_staff(): readable before claims exist, so
-- the app can tell "signed in but not linked" from "signed in as a member".
create or replace function public.current_member()
returns table (
  member_id uuid,
  org_id uuid,
  org_name text,
  currency text,
  timezone text,
  home_branch_id uuid,
  home_branch_name text,
  member_code text,
  full_name text,
  email text,
  phone text,
  status public.member_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.org_id, o.name, o.currency, o.timezone,
         m.home_branch_id, b.name,
         m.member_code, m.full_name, m.email, m.phone, m.status
  from public.members m
  join public.orgs o on o.id = m.org_id
  join public.branches b on b.id = m.home_branch_id
  where m.auth_user_id = auth.uid()
    and m.status <> 'left'::public.member_status
    and o.status = 'active'::public.org_status;
$$;

-- The access-token hook now serves both principal types. Staff win when an
-- account is somehow both, because the console is the higher-privilege surface
-- and a staff member checking their own membership should not lose their desk.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb;
  s record;
  m record;
begin
  select st.id, st.org_id, st.role, st.branch_ids
  into s
  from public.staff st
  join public.orgs o on o.id = st.org_id
  where st.auth_user_id = (event ->> 'user_id')::uuid
    and st.status = 'active'::public.staff_status
    and o.status = 'active'::public.org_status
  limit 1;

  claims := coalesce(event -> 'claims', '{}'::jsonb);
  claims := claims - 'org_id' - 'staff_id' - 'staff_role' - 'branch_ids'
                   - 'member_id' - 'role';

  if s.id is not null then
    claims := jsonb_set(claims, '{org_id}', to_jsonb(s.org_id::text));
    claims := jsonb_set(claims, '{staff_id}', to_jsonb(s.id::text));
    claims := jsonb_set(claims, '{staff_role}', to_jsonb(s.role::text));
    claims := jsonb_set(claims, '{role}', to_jsonb(s.role::text));
    claims := jsonb_set(
      claims,
      '{branch_ids}',
      to_jsonb(coalesce(s.branch_ids, '{}'::uuid[])::text[])
    );

    return jsonb_set(event, '{claims}', claims);
  end if;

  select mb.id, mb.org_id, mb.home_branch_id
  into m
  from public.members mb
  join public.orgs o on o.id = mb.org_id
  where mb.auth_user_id = (event ->> 'user_id')::uuid
    and mb.status <> 'left'::public.member_status
    and o.status = 'active'::public.org_status
  limit 1;

  if m.id is not null then
    -- A member's branch scope is their home branch. Class browsing and check-in
    -- are home-branch operations; nothing member-facing spans the chain.
    claims := jsonb_set(claims, '{org_id}', to_jsonb(m.org_id::text));
    claims := jsonb_set(claims, '{member_id}', to_jsonb(m.id::text));
    claims := jsonb_set(claims, '{role}', to_jsonb('member'::text));
    claims := jsonb_set(
      claims,
      '{branch_ids}',
      to_jsonb(array[m.home_branch_id]::text[])
    );
  end if;

  -- Neither principal: a token with no tenant claims. Every RLS policy denies,
  -- which is correct for a suspended account or an invitation not yet linked.
  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Grant hygiene: Postgres grants EXECUTE on new functions to public by default,
-- and Supabase exposes public/anon over PostgREST.
revoke execute on function public.jwt_member_id() from public, anon;
revoke execute on function public.jwt_is_member() from public, anon;
revoke execute on function public.invite_member(uuid, text) from public, anon;
revoke execute on function public.link_member_account() from public, anon;
revoke execute on function public.current_member() from public, anon;

grant execute on function public.jwt_member_id() to authenticated;
grant execute on function public.jwt_is_member() to authenticated;
grant execute on function public.invite_member(uuid, text) to authenticated;
grant execute on function public.link_member_account() to authenticated;
grant execute on function public.current_member() to authenticated;
