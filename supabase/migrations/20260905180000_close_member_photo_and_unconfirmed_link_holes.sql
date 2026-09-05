-- Two holes the member principal opened that the first sweep missed.
--
-- 1. The member-photos read policy on storage.objects tested
--    is_org_member(storage_object_org(name)) alone. Same shape as the table
--    policies fixed in 20260905150200, same consequence now that members carry
--    org_id: any member could download every other member's photo in their
--    gym. Read is staff-only again, and a member gets their own photo, keyed
--    on the <org_id>/<member_id>/ prefix the objects are already stored under.
--
-- 2. link_member_account() trusted auth.users.email without checking whether
--    it was ever confirmed. Someone who signs up with a member's email --
--    which any project setting that issues a session before confirmation makes
--    possible -- could adopt that member's record, history and check-ins. A
--    trust decision inside a security-definer function should not rest on an
--    Auth toggle that can be changed in a dashboard.

-- The member an object belongs to, read from the second folder in its path.
create or replace function public.storage_object_member(object_name text)
returns uuid
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif((string_to_array(object_name, '/'))[2], '')::uuid;
$$;

revoke execute on function public.storage_object_member(text) from public, anon;
grant execute on function public.storage_object_member(text) to authenticated;

drop policy if exists "staff read member photos in their org" on storage.objects;
create policy "staff read member photos in their org"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'member-photos'
    and public.is_org_member(public.storage_object_org(name))
    and public.jwt_is_staff()
  );

create policy "members read their own photo"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'member-photos'
    and public.jwt_is_member()
    and public.is_org_member(public.storage_object_org(name))
    and public.storage_object_member(name) = public.jwt_member_id()
  );

create or replace function public.link_member_account()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_confirmed_at timestamptz;
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

  select lower(u.email), u.email_confirmed_at
  into v_email, v_confirmed_at
  from auth.users u
  where u.id = v_user_id;

  if v_email is null then
    raise exception 'Account has no email address' using errcode = 'check_violation';
  end if;

  -- The email is the only thing tying this account to a membership, so an
  -- unproven one cannot be allowed to claim it. Otherwise signing up as
  -- someone else's address is enough to take over their record.
  if v_confirmed_at is null then
    raise exception 'Confirm your email address before connecting your membership'
      using errcode = 'insufficient_privilege';
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
