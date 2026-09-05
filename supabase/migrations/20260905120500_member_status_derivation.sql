-- members.status is derived, never assigned. It answers one question the front
-- desk asks a hundred times a day -- can this person train today? -- and the
-- only honest source for that is the member's memberships.

create or replace function public.member_computed_status(
  p_member_id uuid,
  p_left_on date
)
returns public.member_status
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date;
  target_org uuid;
begin
  if p_left_on is not null then
    return 'left'::public.member_status;
  end if;

  select m.org_id into target_org
  from public.members m
  where m.id = p_member_id;

  if target_org is null then
    -- Called from the BEFORE INSERT trigger: the row is not visible yet and it
    -- cannot have memberships.
    return 'expired'::public.member_status;
  end if;

  today := public.org_today(target_org);

  if exists (
    select 1
    from public.memberships ms
    where ms.member_id = p_member_id
      and ms.status = 'active'
      and ms.start_date <= today
      and (ms.end_date is null or ms.end_date >= today)
      and (ms.plan_type = 'time' or coalesce(ms.sessions_remaining, 0) > 0)
  ) then
    return 'active'::public.member_status;
  end if;

  if exists (
    select 1
    from public.memberships ms
    where ms.member_id = p_member_id
      and ms.status = 'frozen'
  ) then
    return 'frozen'::public.member_status;
  end if;

  return 'expired'::public.member_status;
end;
$$;

revoke execute on function public.member_computed_status(uuid, date) from public, anon, authenticated;

-- Whatever the caller passed for status is discarded. This is the reason the
-- application never has to remember the rule.
create or replace function public.derive_member_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.status := public.member_computed_status(new.id, new.left_on);
  return new;
end;
$$;

revoke execute on function public.derive_member_status() from public, anon, authenticated;

create trigger members_derive_status
  before insert or update on public.members
  for each row execute function public.derive_member_status();

-- Membership lifecycle moved, so the member's answer may have moved with it.
create or replace function public.refresh_member_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_member uuid;
begin
  if tg_op = 'DELETE' then
    target_member := old.member_id;
  else
    target_member := new.member_id;
  end if;

  update public.members m
     set status = public.member_computed_status(m.id, m.left_on)
   where m.id = target_member
     and m.status is distinct from public.member_computed_status(m.id, m.left_on);

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke execute on function public.refresh_member_status() from public, anon, authenticated;

create trigger memberships_refresh_member_status
  after insert or update or delete on public.memberships
  for each row execute function public.refresh_member_status();


-- NIGHTLY SWEEP --------------------------------------------------------------
-- Expiry is a date crossing, not an event, so nothing fires on its own. This is
-- what turns yesterday's active memberships into today's renewal list.

create or replace function public.sweep_membership_expiry()
returns table (started integer, expired integer, members_touched integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  started_count integer;
  expired_count integer;
  touched integer;
begin
  -- Memberships sold ahead of time become current on their start date.
  with promoted as (
    update public.memberships ms
       set status = 'active'
     where ms.status = 'upcoming'
       and ms.start_date <= public.org_today(ms.org_id)
       and (ms.end_date is null or ms.end_date >= public.org_today(ms.org_id))
    returning ms.member_id
  )
  select count(*) into started_count from promoted;

  -- Time memberships lapse on their end date. Session packs lapse when the
  -- balance is gone, or when their validity window closes.
  with lapsed as (
    update public.memberships ms
       set status = 'expired'
     where ms.status in ('active', 'upcoming')
       and (
         (ms.end_date is not null and ms.end_date < public.org_today(ms.org_id))
         or (ms.plan_type = 'session_pack' and coalesce(ms.sessions_remaining, 0) = 0)
       )
    returning ms.member_id
  )
  select count(*) into expired_count from lapsed;

  with recomputed as (
    update public.members m
       set status = public.member_computed_status(m.id, m.left_on)
     where m.status is distinct from public.member_computed_status(m.id, m.left_on)
    returning m.id
  )
  select count(*) into touched from recomputed;

  return query select started_count, expired_count, touched;
end;
$$;

revoke execute on function public.sweep_membership_expiry() from public, anon, authenticated;
