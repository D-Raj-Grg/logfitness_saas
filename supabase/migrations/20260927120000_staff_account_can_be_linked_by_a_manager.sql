-- A staff row can end up "active" with no auth account behind it: an owner
-- deactivates an invited colleague and then reactivates them, and the toggle
-- writes `active` without asking whether anyone ever signed up. From then on
-- link_staff_account() -- which only adopts `invited` rows -- refuses that
-- person forever, even after they create an account with the invited email.
--
-- Two repairs. link_staff_account() now adopts any unlinked row for the
-- email, whatever its status, since "no account attached yet" is the real
-- precondition. And a new link_staff_account_by_email(p_staff_id) lets an
-- owner or manager do the same from the Staff page for a colleague, which is
-- what "Reset password" needs when the row it is aiming at has no
-- auth_user_id: either an account already exists for that email and should be
-- adopted, or none does and the server creates one first.

create or replace function public.link_staff_account()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_staff_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select id into v_staff_id from public.staff where auth_user_id = v_user_id;
  if v_staff_id is not null then
    return v_staff_id;
  end if;

  select lower(email) into v_email from auth.users where id = v_user_id;
  if v_email is null then
    raise exception 'Account has no email address' using errcode = 'check_violation';
  end if;

  -- Any unlinked row for this email is the invitation, whatever status a
  -- reactivate toggle may have left on it. A deactivated row stays that way:
  -- linking it only records who the account is, current_staff() still
  -- requires `active`.
  update public.staff
  set auth_user_id = v_user_id,
      status = case
        when status = 'inactive'::public.staff_status then status
        else 'active'::public.staff_status
      end,
      accepted_at = coalesce(accepted_at, now())
  where lower(email) = v_email
    and auth_user_id is null
  returning id into v_staff_id;

  if v_staff_id is null then
    raise exception 'No pending invitation for this email address'
      using errcode = 'no_data_found';
  end if;

  return v_staff_id;
end;
$$;

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

  -- Same ceiling the reassignment guard applies: a manager reaches front desk
  -- and trainers, never an owner or another manager.
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

  -- No account yet: the caller creates one and calls again.
  if v_user_id is null then
    return null;
  end if;

  update public.staff
  set auth_user_id = v_user_id,
      accepted_at = coalesce(accepted_at, now())
  where id = v_staff.id;

  return v_user_id;
end;
$$;

revoke execute on function public.link_staff_account() from public, anon;
grant execute on function public.link_staff_account() to authenticated;

revoke execute on function public.link_staff_account_by_email(uuid) from public, anon;
grant execute on function public.link_staff_account_by_email(uuid) to authenticated;

comment on function public.link_staff_account_by_email(uuid) is
  'Attaches the auth account whose email matches a staff row, for an owner or manager acting on a colleague. Returns the auth user id, or null when no account exists for that email yet.';
