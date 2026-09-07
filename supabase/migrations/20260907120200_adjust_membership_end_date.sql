-- Move the end date of a membership that has already been sold.
--
-- Two real requests from the floor: a relative gets a few complimentary days,
-- and a desk that typed the wrong plan wants the window corrected without
-- voiding an invoice. Neither is a new sale, so neither should insert a
-- membership row.
--
-- Free days are money, so this is owner and manager only -- the front desk can
-- sell and freeze, but not extend. The check is inside the function rather than
-- in RLS: the memberships update policy exists for freeze, unfreeze and cancel,
-- which the desk is allowed to do, so the narrower rule has to live here.
--
-- Only end_date moves. start_date, price, plan and branch are what was sold and
-- guard_membership_immutability still refuses to let any of them change.
create or replace function public.adjust_membership_end_date(
  p_membership_id uuid,
  p_end_date date,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := public.jwt_staff_id();
  membership public.memberships%rowtype;
  today date;
  previous_end date;
  delta integer;
  next_status public.membership_status;
begin
  if actor is null then
    raise exception 'Only signed-in staff can change a membership date'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A date change must record a reason' using errcode = 'check_violation';
  end if;

  if p_end_date is null then
    raise exception 'Pick the new end date' using errcode = 'check_violation';
  end if;

  select * into membership from public.memberships where id = p_membership_id;
  if not found then
    raise exception 'Membership not found' using errcode = 'no_data_found';
  end if;

  if not (
    public.jwt_is_owner()
    or (
      public.jwt_staff_role() = 'manager'::public.staff_role
      and public.has_branch_access(membership.branch_id)
    )
  ) then
    raise exception 'Only an owner or the branch manager can change a membership date'
      using errcode = 'insufficient_privilege';
  end if;

  if membership.status = 'cancelled' then
    raise exception 'This membership is cancelled; sell a new one instead'
      using errcode = 'check_violation';
  end if;

  if membership.end_date is null then
    raise exception 'This membership has no end date to move'
      using errcode = 'check_violation';
  end if;

  if p_end_date < membership.start_date then
    raise exception 'The end date cannot fall before the start date (%)', membership.start_date
      using errcode = 'check_violation';
  end if;

  today := public.org_today(membership.org_id);
  previous_end := membership.end_date;
  delta := p_end_date - previous_end;

  -- A membership the nightly sweep has already expired comes back to life when
  -- its new end date is in the future -- which is the whole point of extending
  -- one. A frozen membership keeps its freeze; unfreezing still adds the paused
  -- days on top of the date set here.
  next_status := case
    when membership.status = 'frozen' then membership.status
    when membership.start_date > today then 'upcoming'::public.membership_status
    when p_end_date >= today then 'active'::public.membership_status
    else 'expired'::public.membership_status
  end;

  update public.memberships
     set end_date = p_end_date,
         status = next_status,
         -- The reason belongs on the row the auditor is looking at, not only in
         -- audit_log. Appended, so earlier adjustments are not overwritten.
         notes = btrim(
           coalesce(notes || E'\n', '')
           || to_char(today, 'YYYY-MM-DD') || ': end date '
           || previous_end || ' -> ' || p_end_date
           || ' (' || btrim(p_reason) || ')'
         )
   where id = membership.id
  returning * into membership;

  if not found then
    raise exception 'You can only change memberships at your own branch'
      using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'membership_id', membership.id,
    'member_id', membership.member_id,
    'previous_end_date', previous_end,
    'end_date', membership.end_date,
    'days_changed', delta,
    'status', membership.status
  );
end;
$$;

revoke execute on function public.adjust_membership_end_date(uuid, date, text)
  from public, anon;
grant execute on function public.adjust_membership_end_date(uuid, date, text)
  to authenticated;
