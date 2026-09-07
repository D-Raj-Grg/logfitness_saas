-- Role and branch changes have consequences RLS cannot express as a policy:
-- an org with no owner cannot be administered again, and a non-owner with no
-- branches can see nothing. Both are one UPDATE away, so the table refuses
-- them rather than trusting every caller to remember. Two more rules live
-- here too: nobody edits their own role, and a manager cannot reach past a
-- peer manager -- RLS's "manager may update any non-owner row" is wider than
-- the product intends.
--
-- This overlaps on purpose with two existing triggers (staff_enforce_last_owner
-- and staff_validate_branches), which already refuse most of these paths.
-- The overlap is kept because this trigger is meant to read, on its own, as
-- the complete statement of "what an UPDATE to role/branch_ids/status must
-- satisfy" -- a reader should not need to know those other triggers exist to
-- trust this one.
create or replace function public.guard_staff_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining_owners integer;
begin
  -- A non-owner must work somewhere.
  if new.role <> 'owner'::public.staff_role
     and coalesce(array_length(new.branch_ids, 1), 0) = 0 then
    raise exception 'A % must be assigned at least one branch.', new.role
      using errcode = 'check_violation';
  end if;

  -- Nobody changes their own role: the only way back from a mistake would be
  -- another owner, and this is exactly how an org loses its last one.
  --
  -- Identity is taken from the staff_id JWT claim (public.jwt_staff_id()),
  -- the same accessor RLS and the other staff triggers use, rather than
  -- comparing new.auth_user_id to auth.uid(). That comparison looks safe --
  -- an invited row's auth_user_id is null until the invite is accepted, and
  -- the null-guard means a null on one side never matches a null on the
  -- other -- but it is still the wrong test here: the actor making this
  -- request is always an accepted, signed-in staff member (the update would
  -- never reach this trigger otherwise), so new.auth_user_id is never null
  -- for the row that matters, and jwt_staff_id() names that actor directly
  -- without a detour through auth.users.
  if new.role is distinct from old.role
     and public.jwt_staff_id() is not null
     and new.id = public.jwt_staff_id() then
    raise exception 'You cannot change your own role.'
      using errcode = 'check_violation';
  end if;

  -- A manager staffs their own floor and cannot reach a peer manager's row.
  -- RLS only excludes role = 'owner' from what a manager may touch, which
  -- leaves other managers exposed.
  if public.jwt_staff_role() = 'manager'::public.staff_role
     and old.role = 'manager'::public.staff_role
     and old.id <> public.jwt_staff_id() then
    raise exception 'A manager cannot reassign another manager.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The last active owner stays an owner and stays active. Demoting them and
  -- deactivating them are the same failure by two different doors.
  if old.role = 'owner'::public.staff_role
     and old.status = 'active'::public.staff_status
     and (new.role <> 'owner'::public.staff_role or new.status <> 'active'::public.staff_status) then
    select count(*) into v_remaining_owners
    from public.staff s
    where s.org_id = old.org_id
      and s.role = 'owner'::public.staff_role
      and s.status = 'active'::public.staff_status
      and s.id <> old.id;

    if v_remaining_owners = 0 then
      raise exception 'This is the last owner. Appoint another owner first.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

revoke execute on function public.guard_staff_assignment() from public, anon, authenticated;

drop trigger if exists guard_staff_assignment on public.staff;

create trigger guard_staff_assignment
  before update of role, branch_ids, status on public.staff
  for each row execute function public.guard_staff_assignment();
