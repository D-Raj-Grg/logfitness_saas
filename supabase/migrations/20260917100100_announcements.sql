-- Announcements: one message, to everybody the gym picks, now or on a date.
--
-- The gym closes for Vishwakarma Puja and has to say so. Until now the only
-- way to tell 400 members was to open 400 row menus. This is the broadcast the
-- PRD calls a non-goal -- an explicit scope decision, taken because "we are
-- shut tomorrow" is an operational fact, not marketing automation. What is
-- deliberately still absent: segments, drip sequences, open tracking, and any
-- notion of a funnel. One composer, one audience, one send.
--
-- It is not a new pipeline. An announcement is a pile of ordinary rows in
-- `notification_messages`, which means the same gateway, the same one-minute
-- worker, the same retry and backoff, the same delivery log, and the same
-- answer to "was this person told". Four additions:
--
--   announcements                    the composed message and who it was for,
--                                    so a send has a record separate from its
--                                    400 outbox rows.
--   notification_messages.announcement_id
--                                    which broadcast a row belongs to. Null
--                                    for everything a sweep or a desk raised.
--   send_announcement                compose and fan out, in one statement.
--   announcement_audience_count      what the desk sees before it spends the
--                                    gym's credit.
--
-- **Scheduling is free.** `send_notification_batch` claims on
-- `next_attempt_at <= now()`, so a row dated next Tuesday simply sits in the
-- outbox until Tuesday. No new cron job, no scheduler, and -- the part that
-- matters -- a scheduled announcement is visible in the delivery log the
-- moment it is created rather than appearing out of nowhere on the day.
--
-- Consent, in three parts:
--
--   * `members.notifications_opt_out` is honoured. An opted-out member is not
--     in the audience at all, not even as a skipped row: they asked not to be
--     contacted, and an announcement is the least urgent thing here.
--   * Visitors have no opt-out column (20260912100100 explains why), so the
--     audience takes only `new` and `contacted`. A visitor marked `lost` said
--     no, and a `converted` one is a member now and would be told twice.
--   * A visitor whose number matches a member already in the audience is
--     dropped. "Both" means both groups of people, not both rows.

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'announcement_audience') then
    create type public.announcement_audience as enum ('members', 'visitors', 'both');
  end if;
end;
$$;

-- `sending` is the whole window between "the rows exist" and "the worker has
-- finished with the last of them", which is usually under a minute. `sent` is
-- derived and set by the same view that counts, not stored -- a stored one
-- would need a trigger on every outbox update, and would still be wrong for a
-- row that failed after it was written.
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'announcement_status') then
    create type public.announcement_status as enum ('scheduled', 'sending', 'cancelled');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- the table
-- ---------------------------------------------------------------------------

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,

  -- Null is "every branch this sender covers". A chain owner announcing a
  -- national holiday should not have to send it three times.
  branch_id uuid,

  -- Not sent anywhere on SMS. It is what the list is read by, so the log is
  -- legible a month later without opening each row.
  title text not null check (length(btrim(title)) between 1 and 120),

  -- Capped where `notification_messages.body` caps, because that is where it
  -- is going. The composer counts segments, not characters: a Devanagari
  -- message is UCS-2 and fits 70 to a segment, not 160.
  body text not null check (length(btrim(body)) between 1 and 1000),

  channel public.notification_channel not null default 'sms',
  audience public.announcement_audience not null,

  -- Null is every status but `left`. Somebody who has left the gym is not
  -- told when it reopens.
  member_statuses public.member_status[],

  -- Null is every open visitor. A number is "visited within N days", which is
  -- the only visitor filter a desk has ever asked for out loud.
  visitor_days integer check (visitor_days is null or visitor_days between 1 and 3650),

  status public.announcement_status not null default 'sending',

  -- When the outbox rows become due. Always set -- `now()` for a send now --
  -- so "when did this go out" has one column rather than two cases.
  scheduled_for timestamptz not null default now(),

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, org_id),

  -- An audience of visitors only cannot carry a member filter, and vice
  -- versa. Storing a filter that was never applied makes the record lie.
  constraint announcements_filter_shape check (
    (audience <> 'visitors' or member_statuses is null)
    and (audience <> 'members' or visitor_days is null)
  )
);

alter table public.announcements
  drop constraint if exists announcements_org_id_fkey;
alter table public.announcements
  add constraint announcements_org_id_fkey
    foreign key (org_id) references public.orgs (id) on delete cascade;

alter table public.announcements
  drop constraint if exists announcements_branch_id_fkey;
alter table public.announcements
  add constraint announcements_branch_id_fkey
    foreign key (branch_id, org_id)
    references public.branches (id, org_id) on delete set null (branch_id);

alter table public.announcements
  drop constraint if exists announcements_created_by_fkey;
alter table public.announcements
  add constraint announcements_created_by_fkey
    foreign key (created_by, org_id)
    references public.staff (id, org_id) on delete set null (created_by);

create index if not exists announcements_org_created_idx
  on public.announcements (org_id, created_at desc);

create index if not exists announcements_scheduled_idx
  on public.announcements (org_id, scheduled_for desc)
  where status = 'scheduled'::public.announcement_status;

drop trigger if exists announcements_set_updated_at on public.announcements;
create trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

drop trigger if exists announcements_audit on public.announcements;
create trigger announcements_audit
  after insert or update or delete on public.announcements
  for each row execute function public.audit_row();

comment on table public.announcements is
  'One broadcast: the wording, the audience it was picked for, and when it was due. The messages themselves are notification_messages rows carrying announcement_id.';

-- RLS ------------------------------------------------------------------------

alter table public.announcements enable row level security;

-- Read is org-wide. A manager at Hetauda must be able to see that the owner
-- announced a closure nationally, or they will announce it again.
drop policy if exists "staff read announcements in their org" on public.announcements;
create policy "staff read announcements in their org"
  on public.announcements for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

-- Writes go through `send_announcement` and `cancel_announcement`, which are
-- security definer. No insert, update or delete policy exists on purpose: a
-- broadcast spends the gym's SMS credit, and there is exactly one door.

-- ---------------------------------------------------------------------------
-- the outbox learns which broadcast a row belongs to
-- ---------------------------------------------------------------------------

alter table public.notification_messages
  add column if not exists announcement_id uuid;

-- Composite, like every other tenant-scoped key here. `set null` on the one
-- column: deleting the announcement record does not unsend the texts, and
-- nulling `org_id` along with it would strand the log row outside its tenant.
alter table public.notification_messages
  drop constraint if exists notification_messages_announcement_fk;
alter table public.notification_messages
  add constraint notification_messages_announcement_fk
    foreign key (announcement_id, org_id)
    references public.announcements (id, org_id) on delete set null (announcement_id);

create index if not exists notification_messages_announcement_idx
  on public.notification_messages (announcement_id, status)
  where announcement_id is not null;

comment on column public.notification_messages.announcement_id is
  'The broadcast this row was part of. Null for anything a sweep or a single manual send raised.';

-- ---------------------------------------------------------------------------
-- who would receive it
-- ---------------------------------------------------------------------------

-- Internal. The audience is computed in one place so that the count the desk
-- is shown and the rows that are actually written cannot disagree -- the
-- preview and the send call the same function with the same arguments.
--
-- Security definer, and it reads members and visitors across the org, so it
-- takes the branch scope as an argument rather than trusting RLS: the caller
-- has already been checked against `has_branch_access`.
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
      case when p_channel = 'email' then lower(nullif(btrim(m.email), ''))
           else public.normalise_msisdn(m.phone) end as usable_address
    from public.members m
    where p_audience in ('members', 'both')
      and m.org_id = p_org_id
      and m.archived_at is null
      -- Not a skipped row: an opt-out is a standing instruction, and an
      -- announcement is the least urgent thing this gym sends.
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
      case when p_channel = 'email' then null
           else public.normalise_msisdn(v.phone) end as usable_address
    from public.visitors v
    where p_audience in ('visitors', 'both')
      and v.org_id = p_org_id
      -- `lost` asked not to be chased; `converted` is a member and is already
      -- counted on the other side of the union.
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
  select kind, recipient_id, branch_id, full_name,
         coalesce(usable_address,
                  case when length(btrim(coalesce(phone, ''))) >= 3
                       then btrim(phone) else 'unknown' end),
         usable_address is not null
  from picked_members
  union all
  select kind, recipient_id, branch_id, full_name,
         coalesce(usable_address,
                  case when length(btrim(coalesce(phone, ''))) >= 3
                       then btrim(phone) else 'unknown' end),
         usable_address is not null
  from deduped_visitors;
$$;

revoke execute on function public.announcement_audience(
  uuid, uuid[], public.announcement_audience, public.member_status[], integer,
  public.notification_channel
) from public, anon, authenticated;

-- The branch scope, resolved once. An explicit branch is checked against the
-- sender's access; null means "every branch they cover", which for an owner is
-- the whole chain (null array, no filter) and for a manager is their list.
create or replace function public.announcement_branch_scope(p_branch_id uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.jwt_org_id();
  v_role public.staff_role := public.jwt_staff_role();
  v_branches uuid[];
begin
  if p_branch_id is not null then
    if not public.has_branch_access(p_branch_id) then
      raise exception 'That branch is outside your access'
        using errcode = 'insufficient_privilege';
    end if;
    return array[p_branch_id];
  end if;

  if v_role = 'owner'::public.staff_role then
    return null;
  end if;

  select s.branch_ids into v_branches
  from public.staff s
  where s.id = public.jwt_staff_id() and s.org_id = v_org;

  -- A manager with no branches assigned covers the org, which is how
  -- `has_branch_access` already reads an empty list.
  if v_branches is null or cardinality(v_branches) = 0 then
    return null;
  end if;

  return v_branches;
end;
$$;

revoke execute on function public.announcement_branch_scope(uuid) from public, anon;
grant execute on function public.announcement_branch_scope(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- what the composer shows before anything is spent
-- ---------------------------------------------------------------------------

-- The recipient count, split the way the money is: `reachable` is what will
-- actually be attempted, `unusable` is what will land in the log as skipped.
-- Callable by the roles that may send, and it resolves its own branch scope,
-- so a manager counting "all branches" counts only their own.
create or replace function public.announcement_audience_count(
  p_audience public.announcement_audience,
  p_branch_id uuid default null,
  p_member_statuses public.member_status[] default null,
  p_visitor_days integer default null,
  p_channel public.notification_channel default 'sms'
)
returns table (
  total integer,
  reachable integer,
  unusable integer,
  members integer,
  visitors integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.jwt_org_id();
  v_branches uuid[];
begin
  if v_org is null or not public.jwt_is_staff()
     or public.jwt_staff_role() not in ('owner'::public.staff_role, 'manager'::public.staff_role) then
    raise exception 'Only an owner or manager can send an announcement'
      using errcode = 'insufficient_privilege';
  end if;

  v_branches := public.announcement_branch_scope(p_branch_id);

  return query
  select
    count(*)::integer,
    count(*) filter (where a.usable)::integer,
    count(*) filter (where not a.usable)::integer,
    count(*) filter (where a.kind = 'member')::integer,
    count(*) filter (where a.kind = 'visitor')::integer
  from public.announcement_audience(
    v_org, v_branches, p_audience, p_member_statuses, p_visitor_days, p_channel
  ) a;
end;
$$;

revoke execute on function public.announcement_audience_count(
  public.announcement_audience, uuid, public.member_status[], integer,
  public.notification_channel
) from public, anon;
grant execute on function public.announcement_audience_count(
  public.announcement_audience, uuid, public.member_status[], integer,
  public.notification_channel
) to authenticated;

-- ---------------------------------------------------------------------------
-- send
-- ---------------------------------------------------------------------------

-- Compose and fan out in one call. Not a loop over `enqueue_notification`:
-- 400 round trips from a Server Action would take longer than the send
-- window, and a failure halfway would leave a half-announced closure. One
-- INSERT ... SELECT, one transaction, all or nothing.
--
-- The checks `enqueue_notification` would have made are made here instead, in
-- the same order: staff, role, branch, non-blank body. Opt-out is enforced
-- inside `announcement_audience` by exclusion rather than refusal, because a
-- broadcast has no one person to refuse.
create or replace function public.send_announcement(
  p_title text,
  p_body text,
  p_audience public.announcement_audience,
  p_channel public.notification_channel default 'sms',
  p_branch_id uuid default null,
  p_member_statuses public.member_status[] default null,
  p_visitor_days integer default null,
  p_scheduled_for timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.jwt_org_id();
  v_actor uuid := public.jwt_staff_id();
  v_branches uuid[];
  v_due timestamptz;
  v_id uuid;
  v_org_name text;
  v_written integer;
begin
  if v_org is null or v_actor is null or not public.jwt_is_staff()
     or public.jwt_staff_role() not in ('owner'::public.staff_role, 'manager'::public.staff_role) then
    raise exception 'Only an owner or manager can send an announcement'
      using errcode = 'insufficient_privilege';
  end if;

  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'The message cannot be blank'
      using errcode = 'check_violation';
  end if;

  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'Give the announcement a title'
      using errcode = 'check_violation';
  end if;

  -- A minute of slack: the composer's clock and the database's are not the
  -- same clock, and "send now" arriving as one second in the past should not
  -- be refused.
  if p_scheduled_for is not null and p_scheduled_for < now() - interval '1 minute' then
    raise exception 'That time has already passed'
      using errcode = 'check_violation';
  end if;

  v_branches := public.announcement_branch_scope(p_branch_id);
  v_due := greatest(coalesce(p_scheduled_for, now()), now());

  select o.name into v_org_name from public.orgs o where o.id = v_org;

  insert into public.announcements (
    org_id, branch_id, title, body, channel, audience, member_statuses,
    visitor_days, status, scheduled_for, created_by
  )
  values (
    v_org, p_branch_id, btrim(p_title), btrim(p_body), p_channel, p_audience,
    case when p_audience = 'visitors' then null else p_member_statuses end,
    case when p_audience = 'members' then null else p_visitor_days end,
    case when v_due > now() + interval '1 minute'
         then 'scheduled'::public.announcement_status
         else 'sending'::public.announcement_status end,
    v_due, v_actor
  )
  returning id into v_id;

  -- The body is rendered per recipient, so `{{name}}` works and an unknown
  -- variable resolves to nothing rather than printing braces at a member.
  -- Rendered at enqueue time, like every other message here: editing the
  -- announcement afterwards cannot change what somebody was told.
  insert into public.notification_messages (
    org_id, branch_id, member_id, visitor_id, announcement_id, created_by,
    channel, event, to_address, subject, body, status, last_error,
    scheduled_for, next_attempt_at, dedupe_key
  )
  select
    v_org,
    a.branch_id,
    case when a.kind = 'member' then a.recipient_id end,
    case when a.kind = 'visitor' then a.recipient_id end,
    v_id,
    v_actor,
    p_channel,
    'announcement'::public.notification_event,
    a.to_address,
    null,
    public.render_notification_template(
      btrim(p_body),
      jsonb_build_object(
        'name', a.full_name,
        'member_name', a.full_name,
        'visitor_name', a.full_name,
        'gym_name', coalesce(v_org_name, ''),
        'branch_name', coalesce(b.name, v_org_name, ''),
        'title', btrim(p_title)
      )
    ),
    case when a.usable then 'queued'::public.notification_status
         else 'skipped'::public.notification_status end,
    case when not a.usable
         then 'No usable ' || p_channel::text || ' address' end,
    v_due,
    v_due,
    'announcement:' || v_id::text || ':' || a.kind || ':' || a.recipient_id::text
  from public.announcement_audience(
    v_org, v_branches, p_audience, p_member_statuses, p_visitor_days, p_channel
  ) a
  left join public.branches b on b.id = a.branch_id and b.org_id = v_org
  on conflict (org_id, dedupe_key) do nothing;

  get diagnostics v_written = row_count;

  -- An empty audience is a mistake being made, not a send: the desk picked
  -- expired members at a branch that has none, and would otherwise see a
  -- "sent" row addressed to nobody.
  if v_written = 0 then
    raise exception 'Nobody matches that audience'
      using errcode = 'no_data_found';
  end if;

  return v_id;
end;
$$;

revoke execute on function public.send_announcement(
  text, text, public.announcement_audience, public.notification_channel, uuid,
  public.member_status[], integer, timestamptz
) from public, anon;
grant execute on function public.send_announcement(
  text, text, public.announcement_audience, public.notification_channel, uuid,
  public.member_status[], integer, timestamptz
) to authenticated;

-- ---------------------------------------------------------------------------
-- cancel
-- ---------------------------------------------------------------------------

-- Stops what has not gone yet. Anything already `sending`, `sent` or `failed`
-- is left alone -- an SMS cannot be recalled, and rewriting its log row would
-- be a lie about what a member received. Returns how many were actually
-- stopped, so the screen can say "142 of 400 stopped" rather than implying the
-- whole thing was undone.
create or replace function public.cancel_announcement(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.jwt_org_id();
  v_row public.announcements%rowtype;
  v_n integer := 0;
begin
  if v_org is null or not public.jwt_is_staff()
     or public.jwt_staff_role() not in ('owner'::public.staff_role, 'manager'::public.staff_role) then
    raise exception 'Only an owner or manager can cancel an announcement'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.announcements
  where id = p_id and org_id = v_org;

  if v_row.id is null then
    raise exception 'That announcement no longer exists'
      using errcode = 'no_data_found';
  end if;

  update public.notification_messages
     set status = 'cancelled'::public.notification_status,
         last_error = 'The announcement was cancelled'
   where announcement_id = p_id
     and org_id = v_org
     and status = 'queued'::public.notification_status;

  get diagnostics v_n = row_count;

  update public.announcements
     set status = 'cancelled'::public.announcement_status
   where id = p_id and org_id = v_org;

  return v_n;
end;
$$;

revoke execute on function public.cancel_announcement(uuid) from public, anon;
grant execute on function public.cancel_announcement(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- the list
-- ---------------------------------------------------------------------------

-- Counts read off the outbox rather than stored on the announcement, because
-- the outbox is what actually happened. `security_invoker` so the view is
-- governed by the announcements policy above and not by its owner.
create or replace view public.announcement_overview
with (security_invoker = true) as
select
  a.id,
  a.org_id,
  a.branch_id,
  b.name as branch_name,
  a.title,
  a.body,
  a.channel,
  a.audience,
  a.member_statuses,
  a.visitor_days,
  a.status,
  a.scheduled_for,
  a.created_at,
  a.created_by,
  s.full_name as created_by_name,
  coalesce(m.total, 0)::integer as total,
  coalesce(m.queued, 0)::integer as queued,
  coalesce(m.sent, 0)::integer as sent,
  coalesce(m.failed, 0)::integer as failed,
  coalesce(m.skipped, 0)::integer as skipped,
  coalesce(m.cancelled, 0)::integer as cancelled,
  m.last_sent_at
from public.announcements a
left join public.branches b on b.id = a.branch_id and b.org_id = a.org_id
left join public.staff s on s.id = a.created_by and s.org_id = a.org_id
left join lateral (
  select
    count(*) as total,
    count(*) filter (where n.status in ('queued'::public.notification_status,
                                        'sending'::public.notification_status)) as queued,
    count(*) filter (where n.status = 'sent'::public.notification_status) as sent,
    count(*) filter (where n.status = 'failed'::public.notification_status) as failed,
    count(*) filter (where n.status = 'skipped'::public.notification_status) as skipped,
    count(*) filter (where n.status = 'cancelled'::public.notification_status) as cancelled,
    max(n.sent_at) as last_sent_at
  from public.notification_messages n
  where n.announcement_id = a.id and n.org_id = a.org_id
) m on true;

comment on view public.announcement_overview is
  'One row per broadcast with its delivery counted off the outbox. The counts are live: a scheduled announcement reads all-queued until its hour.';

revoke all on public.announcement_overview from public, anon;
grant select on public.announcement_overview to authenticated;
