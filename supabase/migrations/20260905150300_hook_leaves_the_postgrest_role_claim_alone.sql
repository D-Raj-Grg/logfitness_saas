-- The previous migration stamped the principal's role into the `role` claim.
-- That claim is not ours: PostgREST reads it to decide which Postgres role to
-- `set role` to for the request. Overwriting it with 'front_desk' or 'member'
-- would have made every authenticated request fail on a role that does not
-- exist in the database.
--
-- The principal type is therefore carried by which id claim is present:
-- `staff_role` for staff, `member_id` for members. Nothing else changes.

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

  -- Never touch 'role': that one belongs to PostgREST.
  claims := claims - 'org_id' - 'staff_id' - 'staff_role' - 'branch_ids'
                   - 'member_id';

  if s.id is not null then
    claims := jsonb_set(claims, '{org_id}', to_jsonb(s.org_id::text));
    claims := jsonb_set(claims, '{staff_id}', to_jsonb(s.id::text));
    claims := jsonb_set(claims, '{staff_role}', to_jsonb(s.role::text));
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

-- A member principal is one that carries member_id and is not staff. Reading it
-- off `role` would have been reading PostgREST's claim, not ours.
create or replace function public.jwt_is_member()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.jwt_member_id() is not null
     and public.jwt_staff_role() is null;
$$;
