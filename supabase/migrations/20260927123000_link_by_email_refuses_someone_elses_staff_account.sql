-- link_staff_account_by_email() adopted any auth account whose email matched,
-- including one already serving as staff at another gym. Combined with a
-- password overwrite that would hand the caller that account. An account that
-- is already somebody's staff login is never adopted by a colleague's action;
-- only the account holder, signing in and linking themselves, can move it.

create or replace function public.link_staff_account_by_email(p_staff_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff%rowtype;
  v_user_id uuid;
begin
  if public.jwt_staff_role() not in ('owner'::public.staff_role, 'manager'::public.staff_role) then
    raise exception 'Only an owner or manager can link a staff account'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_staff
  from public.staff
  where id = p_staff_id
    and org_id = public.jwt_org_id();

  if v_staff.id is null then
    raise exception 'Staff member not found' using errcode = 'no_data_found';
  end if;

  if public.jwt_staff_role() = 'manager'::public.staff_role
     and v_staff.role not in ('front_desk'::public.staff_role, 'trainer'::public.staff_role) then
    raise exception 'A manager cannot link an owner or another manager'
      using errcode = 'insufficient_privilege';
  end if;

  if v_staff.auth_user_id is not null then
    return v_staff.auth_user_id;
  end if;

  select id into v_user_id
  from auth.users
  where lower(email) = lower(v_staff.email)
  order by created_at
  limit 1;

  if v_user_id is null then
    return null;
  end if;

  if exists (select 1 from public.staff where auth_user_id = v_user_id) then
    raise exception 'That email already signs in as staff somewhere else. They can link it themselves by signing in.'
      using errcode = 'check_violation';
  end if;

  update public.staff
  set auth_user_id = v_user_id,
      accepted_at = coalesce(accepted_at, now())
  where id = v_staff.id;

  return v_user_id;
end;
$$;

revoke execute on function public.link_staff_account_by_email(uuid) from public, anon;
grant execute on function public.link_staff_account_by_email(uuid) to authenticated;
