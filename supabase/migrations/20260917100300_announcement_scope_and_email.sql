-- Three more things 20260917100100 got wrong, found writing the gate.
--
-- 1. **A branch id from another chain got past the guard.** `has_branch_access`
--    short-circuits on `jwt_is_owner()` and never looks at the branch's org, so
--    an owner naming another chain's branch was let through and failed later on
--    the composite foreign key with a raw `23503`. Nothing leaked -- the
--    audience would have been empty -- but the refusal belongs at the door,
--    in the sentence the screen can show.
--
-- 2. **Two sources of truth for one question.** The explicit-branch path asked
--    the token (`has_branch_access` -> `jwt_branch_ids()`) and the "everywhere
--    I work" path asked the `staff` table, so the two disagreed for the rest of
--    a session whenever somebody's branch assignment changed. The token is
--    what every other guard in this schema reads, so it is what this reads.
--
-- 3. **The email path addressed members by telephone.** The fallback address
--    was the phone number regardless of channel, so an email announcement to a
--    member with no email on file wrote a `skipped` row whose email address was
--    their mobile -- and, worse, every open visitor got one too, because
--    `visitors` has no email column at all and their usable address is always
--    null on that channel. An email audience is now members with an email
--    address, and nobody else.
--
-- The composer only offers SMS, so (3) was not reachable from the console. It
-- was reachable from the RPC, which the Flutter app and every future
-- integration call directly, and that is the boundary that counts.

create or replace function public.announcement_branch_scope(p_branch_id uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.jwt_org_id();
  v_branches uuid[];
begin
  if p_branch_id is not null then
    -- Both halves are needed. `has_branch_access` answers "may you work
    -- there"; the org check answers "is it yours at all", which for an owner
    -- the first one never asks.
    if not public.has_branch_access(p_branch_id)
       or not exists (
         select 1 from public.branches b
         where b.id = p_branch_id and b.org_id = v_org
       ) then
      raise exception 'That branch is outside your access'
        using errcode = 'insufficient_privilege';
    end if;
    return array[p_branch_id];
  end if;

  v_branches := public.jwt_branch_ids();

  -- An owner, and a manager with no branches assigned, cover the whole org --
  -- which is how `has_branch_access` already reads an empty list. Null here
  -- means no branch filter rather than no branches.
  if v_branches is null or cardinality(v_branches) = 0 then
    return null;
  end if;

  return v_branches;
end;
$$;

revoke execute on function public.announcement_branch_scope(uuid) from public, anon;
grant execute on function public.announcement_branch_scope(uuid) to authenticated;

create or replace function public.announcement_audience(
  p_org_id uuid,
  p_branch_ids uuid[],
  p_audience public.announcement_audience,
  p_member_statuses public.member_status[],
  p_visitor_days integer,
  p_channel public.notification_channel default 'sms'
)
returns table (
  kind text,
  recipient_id uuid,
  branch_id uuid,
  full_name text,
  to_address text,
  usable boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with picked_members as (
    select
      'member'::text as kind,
      m.id as recipient_id,
      m.home_branch_id as branch_id,
      m.full_name,
      m.phone,
      m.email,
      case when p_channel = 'email' then lower(nullif(btrim(m.email), ''))
           else public.normalise_msisdn(m.phone) end as usable_address
    from public.members m
    where p_audience in ('members', 'both')
      and m.org_id = p_org_id
      and m.archived_at is null
      and not m.notifications_opt_out
      and (p_branch_ids is null or m.home_branch_id = any (p_branch_ids))
      and (
        case
          when p_member_statuses is null then m.status <> 'left'::public.member_status
          else m.status = any (p_member_statuses)
        end
      )
  ),
  picked_visitors as (
    select
      'visitor'::text as kind,
      v.id as recipient_id,
      v.branch_id,
      v.full_name,
      v.phone,
      public.normalise_msisdn(v.phone) as usable_address
    from public.visitors v
    where p_audience in ('visitors', 'both')
      -- A walk-in leaves a phone number and nothing else, so there is no such
      -- thing as an email audience of visitors. Excluded rather than written
      -- out as several hundred unsendable rows.
      and p_channel <> 'email'
      and v.org_id = p_org_id
      and v.status in ('new'::public.visitor_status, 'contacted'::public.visitor_status)
      and (p_branch_ids is null or v.branch_id = any (p_branch_ids))
      and (
        p_visitor_days is null
        or v.visited_on >= public.org_today(p_org_id) - p_visitor_days
      )
  ),
  deduped_visitors as (
    select pv.*
    from picked_visitors pv
    where pv.usable_address is null
       or not exists (
            select 1 from picked_members pm
            where pm.usable_address = pv.usable_address
          )
  )
  -- The unusable rows still carry the address as it was typed, because "we
  -- could not send to 01-4567890" is the sentence that gets the number fixed.
  -- It has to be an address of the right *kind*, though: a phone number in the
  -- email column of the log is a second bug reported as the first.
  select kind, recipient_id, branch_id, full_name,
         coalesce(
           usable_address,
           case
             when p_channel = 'email' then nullif(btrim(coalesce(email, '')), '')
             when length(btrim(coalesce(phone, ''))) >= 3 then btrim(phone)
           end,
           'unknown'
         ),
         usable_address is not null
  from picked_members
  union all
  select kind, recipient_id, branch_id, full_name,
         coalesce(
           usable_address,
           case when length(btrim(coalesce(phone, ''))) >= 3 then btrim(phone) end,
           'unknown'
         ),
         usable_address is not null
  from deduped_visitors;
$$;

revoke execute on function public.announcement_audience(
  uuid, uuid[], public.announcement_audience, public.member_status[], integer,
  public.notification_channel
) from public, anon, authenticated;
