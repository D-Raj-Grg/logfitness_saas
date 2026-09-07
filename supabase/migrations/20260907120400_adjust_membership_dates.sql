-- Moving the start date of a membership already sold.
--
-- The desk takes the money on Sunday and the member says "start me Tuesday" --
-- and sometimes says it after the sale is rung up. Until now start_date was
-- immutable full stop, so the only way out was to cancel and re-sell, which
-- voids an invoice over a two-day favour.
--
-- The append-only rule still holds for everything that says what was bought:
-- plan, price, discount, branch, member. The start date joins end_date as a
-- lifecycle column, but only through this one function, and only while the
-- membership has not been used: once someone has trained on it, when it started
-- is a fact about attendance, not a plan.
--
-- The trigger stays the enforcement point. It opens for a start-date change only
-- when this function has set the flag on the transaction, so a direct UPDATE
-- from PostgREST -- which cannot set a GUC -- is refused exactly as before.
create or replace function public.guard_membership_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.org_id is distinct from old.org_id
     or new.member_id is distinct from old.member_id
     or new.plan_id is distinct from old.plan_id
     or new.branch_id is distinct from old.branch_id
     or new.price_paisa is distinct from old.price_paisa
     or new.discount_paisa is distinct from old.discount_paisa
     or new.plan_type is distinct from old.plan_type
     or new.sessions_total is distinct from old.sessions_total
     or new.created_at is distinct from old.created_at then
    raise exception 'Membership history is append-only: sell a new membership instead of rewriting %', old.id
      using errcode = 'insufficient_privilege';
  end if;

  if new.start_date is distinct from old.start_date
     and coalesce(current_setting('app.shift_membership_dates', true), '') <> 'on' then
    raise exception 'The start date of a membership is set when it is sold; use adjust_membership_dates to move it'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_membership_immutability() from public, anon, authenticated;


-- Supersedes adjust_membership_end_date(), which could only push the far end.
drop function if exists public.adjust_membership_end_date(uuid, date, text);

create or replace function public.adjust_membership_dates(
  p_membership_id uuid,
  p_start_date date,
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
  previous_start date;
  previous_end date;
  visits integer;
  next_status public.membership_status;
begin
  if actor is null then
    raise exception 'Only signed-in staff can change a membership date'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A date change must record a reason' using errcode = 'check_violation';
  end if;

  if p_start_date is null then
    raise exception 'Pick the start date' using errcode = 'check_violation';
  end if;

  select * into membership from public.memberships where id = p_membership_id;
  if not found then
    raise exception 'Membership not found' using errcode = 'no_data_found';
  end if;

  -- Free days are money. The desk sells and freezes; moving dates on a sale
  -- already made is an owner or branch-manager decision.
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

  -- A session pack with no validity window has no end date to set, and one
  -- with a window keeps having one.
  if (p_end_date is null) <> (membership.end_date is null) then
    raise exception 'This membership % an end date',
      case when membership.end_date is null then 'does not have' else 'needs' end
      using errcode = 'check_violation';
  end if;

  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'The end date cannot fall before the start date'
      using errcode = 'check_violation';
  end if;

  today := public.org_today(membership.org_id);
  previous_start := membership.start_date;
  previous_end := membership.end_date;

  if p_start_date <> previous_start then
    -- Attendance is what makes a start date a fact rather than a plan. Once a
    -- member has walked in on this membership, moving the start would put
    -- visits outside the window they were checked in against.
    select count(*) into visits
    from public.attendance a where a.membership_id = membership.id;

    if visits > 0 then
      raise exception 'This membership has % check-in% already; its start date cannot move',
        visits, case when visits = 1 then '' else 's' end
        using errcode = 'check_violation';
    end if;

    if membership.status = 'frozen' then
      raise exception 'Unfreeze the membership before moving its start date'
        using errcode = 'check_violation';
    end if;

    -- The one door the immutability trigger opens for, and only for this
    -- statement: `set local` dies with the transaction.
    perform set_config('app.shift_membership_dates', 'on', true);
  end if;

  next_status := case
    when membership.status = 'frozen' then membership.status
    when p_start_date > today then 'upcoming'::public.membership_status
    when p_end_date is null or p_end_date >= today then 'active'::public.membership_status
    else 'expired'::public.membership_status
  end;

  update public.memberships
     set start_date = p_start_date,
         end_date = p_end_date,
         status = next_status,
         -- The reason belongs on the row an auditor is looking at, not only in
         -- audit_log. Appended, so earlier adjustments survive.
         notes = btrim(
           coalesce(notes || E'\n', '')
           || to_char(today, 'YYYY-MM-DD') || ': dates '
           || previous_start || ' - ' || coalesce(previous_end::text, 'open')
           || ' -> ' || p_start_date || ' - ' || coalesce(p_end_date::text, 'open')
           || ' (' || btrim(p_reason) || ')'
         )
   where id = membership.id
  returning * into membership;

  if not found then
    raise exception 'You can only change memberships at your own branch'
      using errcode = 'insufficient_privilege';
  end if;

  perform set_config('app.shift_membership_dates', 'off', true);

  return jsonb_build_object(
    'membership_id', membership.id,
    'member_id', membership.member_id,
    'previous_start_date', previous_start,
    'previous_end_date', previous_end,
    'start_date', membership.start_date,
    'end_date', membership.end_date,
    'days_moved', p_start_date - previous_start,
    'days_changed', coalesce(p_end_date - previous_end, 0),
    'status', membership.status
  );
end;
$$;

revoke execute on function public.adjust_membership_dates(uuid, date, date, text)
  from public, anon;
grant execute on function public.adjust_membership_dates(uuid, date, date, text)
  to authenticated;
