-- The front desk may announce.
--
-- `20260917100100_announcements.sql` put broadcasts behind owner and manager,
-- and the pgTAP suite argued the case in a comment: a broadcast cannot be
-- taken back one row at a time, so the floor roles do not get near it. That
-- reasoning held while "the floor" meant reach over the whole chain. It does
-- not survive contact with the thing the feature is for -- the gym is shut on
-- Sunday and the person standing at the door is the one who knows.
--
-- So the role widens and the reach does not. `announcement_branch_scope`
-- already resolves a non-owner to their own `staff.branch_ids`, and the guard
-- below refuses a desk whose claim is empty, because an empty claim means "the
-- whole org" to that function -- which is exactly the hole the old rule was
-- protecting. A desk announces to its own gym or it does not announce.
--
-- Trainer is still refused, and so is anyone who is not staff.
--
-- `public.announcement_audience` stays revoked from `authenticated`. It takes
-- `p_org_id` as an argument and would hand any caller another org's phone
-- numbers. It is called only from the definer functions below. Do not grant it.

create or replace function public.jwt_can_announce()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.jwt_org_id() is not null
     and public.jwt_is_staff()
     and public.jwt_staff_role() in (
           'owner'::public.staff_role,
           'manager'::public.staff_role,
           'front_desk'::public.staff_role
         )
     -- The desk's reach never widens with its role. An empty `branch_ids`
     -- claim is "every branch" to `announcement_branch_scope`; for an owner
     -- that is correct and intended, for a desk it would be the chain.
     and (
       public.jwt_staff_role() <> 'front_desk'::public.staff_role
       or coalesce(cardinality(public.jwt_branch_ids()), 0) > 0
     );
$$;

comment on function public.jwt_can_announce() is
  'Who may broadcast: owner, manager, and a front desk that has at least one branch of its own.';

revoke execute on function public.jwt_can_announce() from public, anon;
grant execute on function public.jwt_can_announce() to authenticated;

-- ---------------------------------------------------------------------------
-- The four guards
-- ---------------------------------------------------------------------------
-- `create or replace function` cannot patch a body, so each function below is
-- its current definition copied whole, with only the guard block changed. The
-- signatures are byte-identical, so the existing grants carry over; they are
-- re-issued anyway so this file stands on its own.

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
  if not public.jwt_can_announce() then
    raise exception 'Only an owner, manager or front desk can send an announcement'
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
  -- `v_actor` is still required separately: the announcement records who sent
  -- it, and a staff row that cannot be identified cannot be the sender.
  if v_actor is null or not public.jwt_can_announce() then
    raise exception 'Only an owner, manager or front desk can send an announcement'
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

create or replace function public.send_announcement_test(
  p_body text,
  p_to text,
  p_channel public.notification_channel default 'sms',
  p_title text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.jwt_org_id();
  v_actor uuid := public.jwt_staff_id();
  v_org_name text;
  v_actor_name text;
  v_address text;
  v_id uuid;
begin
  if v_actor is null or not public.jwt_can_announce() then
    raise exception 'Only an owner, manager or front desk can send an announcement'
      using errcode = 'insufficient_privilege';
  end if;

  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'The message cannot be blank'
      using errcode = 'check_violation';
  end if;

  v_address := case p_channel
                 when 'email' then lower(nullif(btrim(p_to), ''))
                 else public.normalise_msisdn(p_to)
               end;

  -- A test is the one send where an unusable address must refuse rather than
  -- log a `skipped` row: the whole point is that a handset lights up, and a
  -- quiet row in the log reads exactly like a gateway that is not working.
  if v_address is null then
    raise exception 'That is not a number this can send to'
      using errcode = 'check_violation';
  end if;

  select o.name into v_org_name from public.orgs o where o.id = v_org;
  select s.full_name into v_actor_name
  from public.staff s where s.id = v_actor and s.org_id = v_org;

  insert into public.notification_messages (
    org_id, created_by, channel, event, to_address, body, status,
    scheduled_for, next_attempt_at, dedupe_key
  )
  values (
    v_org, v_actor, p_channel, 'announcement'::public.notification_event,
    v_address,
    -- The sender's own name stands in for the recipient's, so a `{{name}}`
    -- that renders empty is visible as a hole rather than as nothing.
    public.render_notification_template(
      btrim(p_body),
      jsonb_build_object(
        'name', coalesce(v_actor_name, 'there'),
        'member_name', coalesce(v_actor_name, 'there'),
        'visitor_name', coalesce(v_actor_name, 'there'),
        'gym_name', coalesce(v_org_name, ''),
        'branch_name', coalesce(v_org_name, ''),
        'title', btrim(coalesce(p_title, ''))
      )
    ),
    'queued'::public.notification_status,
    now(), now(),
    -- A double click costs a credit and proves nothing, so the same wording to
    -- the same number inside a minute is one message. Wide enough to catch the
    -- second click, narrow enough that fixing a typo and testing again works.
    'announcement_test:' || v_actor::text || ':' || v_address || ':'
      || md5(btrim(p_body)) || ':' || to_char(now(), 'YYYYMMDDHH24MI')
  )
  on conflict (org_id, dedupe_key) do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'That test has just been sent. Give it a minute.'
      using errcode = 'unique_violation';
  end if;

  return v_id;
end;
$$;

revoke execute on function public.send_announcement_test(
  text, text, public.notification_channel, text
) from public, anon;
grant execute on function public.send_announcement_test(
  text, text, public.notification_channel, text
) to authenticated;

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
  if not public.jwt_can_announce() then
    raise exception 'Only an owner, manager or front desk can cancel an announcement'
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

  -- An announcement whose messages have all left is history, not something
  -- that can be called back, and saying otherwise in the log would be the
  -- record disagreeing with what members actually received.
  if v_n > 0 then
    update public.announcements
       set status = 'cancelled'::public.announcement_status
     where id = p_id and org_id = v_org;
  end if;

  return v_n;
end;
$$;

revoke execute on function public.cancel_announcement(uuid) from public, anon;
grant execute on function public.cancel_announcement(uuid) to authenticated;
