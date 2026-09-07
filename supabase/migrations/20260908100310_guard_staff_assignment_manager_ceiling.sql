-- Review finding on 20260908100300_guard_staff_assignment.sql: check 3 there
-- fired on old.role = 'manager', which blocks a manager *reaching* an
-- existing peer, but said nothing about new.role = 'manager' -- a manager
-- could still *manufacture* a peer by promoting a front_desk or trainer they
-- cover. The sibling INSERT policy ("owners and managers invite staff") got
-- this right already: a manager may only ever hand out role = any('front_desk',
-- 'trainer'). This mirrors that exact ceiling on UPDATE rather than inventing
-- a second vocabulary for the same rule, and folds the peer-reach check into
-- the same condition: touching an existing manager row, or leaving a row as
-- anything but front_desk/trainer, are both refused in one place.
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
  -- without a detour through auth.users. Confirmed against
  -- custom_access_token_hook: staff_id and staff_role are set and unset
  -- together (both come from the same `if s.id is not null` branch, and are
  -- both stripped from the incoming claims before that check runs), so a
  -- token that carries staff_role but not staff_id -- which would make this
  -- guard silently skip -- cannot occur.
  if new.role is distinct from old.role
     and public.jwt_staff_id() is not null
     and new.id = public.jwt_staff_id() then
    raise exception 'You cannot change your own role.'
      using errcode = 'check_violation';
  end if;

  -- A manager may only ever leave a covered row as front_desk or trainer.
  -- Mirrors the ceiling "owners and managers invite staff" already applies
  -- on INSERT (role = any('front_desk','trainer')) so the two agree on what
  -- a manager may assign. Reaching an existing manager row is refused
  -- outright regardless of the new value; leaving any row (including a
  -- promoted front_desk/trainer) as anything but front_desk/trainer is
  -- refused too. Self-edits are excluded here because a manager's own role
  -- change is already caught above, and the Server Action never lets a
  -- manager submit this form for their own row at all.
  if public.jwt_staff_role() = 'manager'::public.staff_role
     and old.id <> public.jwt_staff_id()
     and (
       old.role = 'manager'::public.staff_role
       or new.role <> all(array['front_desk', 'trainer']::public.staff_role[])
     ) then
    raise exception 'A manager can only assign front desk or trainer, and cannot reassign another manager.'
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
