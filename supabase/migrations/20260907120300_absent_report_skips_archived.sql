-- The absent-members call list is the one report that walks live members rather
-- than money, so it is the one that has to learn about archiving. An archived
-- member is a record kept for the audit trail, not a person to ring up.
--
-- Everything financial (collections, arrears, invoices) deliberately still
-- counts them: a due is a due whether or not the row is hidden from the desk.
create or replace function public.absent_members(
  p_branch_id uuid default null,
  p_min_days integer default 14
)
returns table (
  member_id uuid,
  member_code text,
  full_name text,
  phone text,
  home_branch_id uuid,
  home_branch_name text,
  membership_end_date date,
  days_to_expiry integer,
  due_paisa bigint,
  last_seen_on date,
  days_absent integer,
  ever_visited boolean,
  band text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with seen as (
    select
      mo.id,
      mo.org_id,
      mo.member_code,
      mo.full_name,
      mo.phone,
      mo.home_branch_id,
      mo.home_branch_name,
      mo.membership_end_date,
      mo.days_to_expiry,
      mo.due_paisa,
      mo.joined_on,
      last_visit.attended_on as last_seen_on
    from public.member_overview mo
    left join lateral (
      select max(a.attended_on) as attended_on
      from public.attendance a
      where a.member_id = mo.id
    ) last_visit on true
    where mo.status = 'active'::public.member_status
      and mo.archived_at is null
      and (p_branch_id is null or mo.home_branch_id = p_branch_id)
  ),
  measured as (
    select
      seen.*,
      (public.org_today(seen.org_id)
        - coalesce(seen.last_seen_on, seen.joined_on))::integer as days_absent
    from seen
  )
  select
    measured.id,
    measured.member_code,
    measured.full_name,
    measured.phone,
    measured.home_branch_id,
    measured.home_branch_name,
    measured.membership_end_date,
    measured.days_to_expiry,
    measured.due_paisa::bigint,
    measured.last_seen_on,
    measured.days_absent,
    measured.last_seen_on is not null,
    case
      when measured.days_absent >= 60 then '60+ days'
      when measured.days_absent >= 30 then '30-59 days'
      else '14-29 days'
    end
  from measured
  where measured.days_absent >= greatest(coalesce(p_min_days, 14), 1)
  order by measured.days_absent desc, measured.full_name;
$$;

revoke execute on function public.absent_members(uuid, integer) from public, anon;
grant execute on function public.absent_members(uuid, integer) to authenticated;
