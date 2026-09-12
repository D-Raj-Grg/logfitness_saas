-- Sending one member a message, now, because someone at the desk decided to.
--
-- Everything Phase 5 shipped is a schedule: three sweeps at 02:30 Kathmandu
-- decide who gets told what. A member standing at the desk owing Rs 3,400 is
-- outside that entirely, and the only path the product offered was a personal
-- handset -- which never lands in `notification_messages`, so "was this member
-- told" had no answer for the one message that mattered most.
--
-- Three additions, and deliberately no fourth:
--
--   member_message_target      internal. Every check the console would
--                              otherwise have to repeat, in one place, raising
--                              sentences rather than codes.
--   member_notification_preview what the message would say and where it would
--                              go, including the reasons it would not go.
--   send_member_notification    the send, which does not write a row itself --
--                              it delegates to `enqueue_notification`, so
--                              there is still exactly one INSERT into the
--                              outbox in the whole system.
--
-- The wording is the org's own template, rendered here from the same variables
-- the sweeps build, so a dues reminder sent by hand reads exactly like the one
-- the sweep would have sent at 02:30. The desk may edit the text before
-- sending; what it actually sent is what the log stores, because rendering
-- happens at enqueue and never at send.
--
-- Consent is not overridable. `notifications_opt_out` refuses a manual send the
-- same way it skips a sweep: a member who asked not to be texted did not mean
-- "unless someone clicks the button".

-- ---------------------------------------------------------------------------
-- who pressed Send
-- ---------------------------------------------------------------------------

-- `staff_id` on this table means the *recipient* (the staff invitation), so
-- until now there was nowhere to record the author of a manual message. The
-- log answers "who texted this member" only if the column exists.
alter table public.notification_messages
  add column if not exists created_by uuid references public.staff (id) on delete set null;

comment on column public.notification_messages.created_by is
  'Staff member who sent this by hand. Null for anything a sweep raised.';

create index if not exists notification_messages_created_by_idx
  on public.notification_messages (created_by)
  where created_by is not null;

-- Unchanged but for `created_by`, which the function already had in hand as
-- `v_actor` and simply never stored.
create or replace function public.enqueue_notification(
  p_channel public.notification_channel,
  p_event public.notification_event,
  p_to text,
  p_body text,
  p_subject text default null,
  p_member_id uuid default null,
  p_staff_id uuid default null,
  p_branch_id uuid default null,
  p_dedupe_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.jwt_org_id();
  v_actor uuid := public.jwt_staff_id();
  v_address text;
  v_id uuid;
begin
  if v_org is null or v_actor is null or not public.jwt_is_staff() then
    raise exception 'Only staff can send a message'
      using errcode = 'insufficient_privilege';
  end if;

  if p_branch_id is not null and not public.has_branch_access(p_branch_id) then
    raise exception 'That branch is outside your access'
      using errcode = 'insufficient_privilege';
  end if;

  if p_member_id is not null and not exists (
    select 1 from public.members m where m.id = p_member_id and m.org_id = v_org
  ) then
    raise exception 'That member is not in your gym'
      using errcode = 'no_data_found';
  end if;

  if p_staff_id is not null and not exists (
    select 1 from public.staff s where s.id = p_staff_id and s.org_id = v_org
  ) then
    raise exception 'That staff member is not in your gym'
      using errcode = 'no_data_found';
  end if;

  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'The message cannot be blank'
      using errcode = 'check_violation';
  end if;

  v_address := case p_channel
                 when 'email' then lower(nullif(btrim(p_to), ''))
                 else public.normalise_msisdn(p_to)
               end;

  insert into public.notification_messages (
    org_id, branch_id, member_id, staff_id, created_by, channel, event,
    to_address, subject, body, status, last_error, dedupe_key
  )
  values (
    v_org, p_branch_id, p_member_id, p_staff_id, v_actor, p_channel, p_event,
    coalesce(v_address, btrim(coalesce(p_to, 'unknown'))),
    nullif(btrim(coalesce(p_subject, '')), ''),
    left(btrim(p_body), 1000),
    case when v_address is null then 'skipped'::public.notification_status
         else 'queued'::public.notification_status end,
    case when v_address is null
         then 'No usable ' || p_channel::text || ' address' end,
    coalesce(nullif(btrim(coalesce(p_dedupe_key, '')), ''),
             'manual:' || gen_random_uuid()::text)
  )
  on conflict (org_id, dedupe_key) do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'That message has already been queued'
      using errcode = 'unique_violation';
  end if;

  return v_id;
end;
$$;

revoke execute on function public.enqueue_notification(
  public.notification_channel, public.notification_event, text, text, text,
  uuid, uuid, uuid, text
) from public, anon;
grant execute on function public.enqueue_notification(
  public.notification_channel, public.notification_event, text, text, text,
  uuid, uuid, uuid, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- the member, and every reason the desk may or may not message them
-- ---------------------------------------------------------------------------

-- Internal, and callable by no client role. Definer because `has_branch_access`
-- and the role check are the whole point: the console asks this one question
-- instead of five, and the preview and the send cannot drift apart.
--
-- Opt-out is reported, not raised. The preview has to be able to say "this
-- member asked not to be messaged" rather than fail; only the send refuses.
create or replace function public.member_message_target(
  p_member_id uuid,
  p_channel public.notification_channel default 'sms'
)
returns table (
  org_id uuid,
  branch_id uuid,
  full_name text,
  to_address text,
  raw_address text,
  reachable boolean,
  opt_out boolean,
  locale text,
  vars jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.jwt_org_id();
  v_role public.staff_role := public.jwt_staff_role();
  r record;
begin
  if v_org is null or public.jwt_staff_id() is null or not public.jwt_is_staff() then
    raise exception 'Only staff can message a member'
      using errcode = 'insufficient_privilege';
  end if;

  -- A trainer sees the floor, not the phone book. Same line the profile draws
  -- with `canManage`, drawn again here because the database is the boundary.
  if v_role not in ('owner'::public.staff_role,
                    'manager'::public.staff_role,
                    'front_desk'::public.staff_role) then
    raise exception 'Your role cannot send messages to members'
      using errcode = 'insufficient_privilege';
  end if;

  -- member_overview already carries the current membership and the outstanding
  -- balance, computed the way the rest of the product computes them. Rebuilding
  -- either here would be a second answer to "what does this member owe".
  select mo.*, o.name as org_name, o.currency
    into r
    from public.member_overview mo
    join public.orgs o on o.id = mo.org_id
   where mo.id = p_member_id
     and mo.org_id = v_org;

  if not found then
    raise exception 'That member is not in your gym'
      using errcode = 'no_data_found';
  end if;

  if r.archived_at is not null then
    raise exception 'That member is archived'
      using errcode = 'no_data_found';
  end if;

  if not public.has_branch_access(r.home_branch_id) then
    raise exception 'That member is at a branch outside your access'
      using errcode = 'insufficient_privilege';
  end if;

  org_id     := r.org_id;
  branch_id  := r.home_branch_id;
  full_name  := r.full_name;
  to_address := case p_channel
                  when 'email' then lower(nullif(btrim(r.email), ''))
                  else public.normalise_msisdn(r.phone)
                end;
  raw_address := case p_channel
                   when 'email' then btrim(coalesce(r.email, ''))
                   else btrim(coalesce(r.phone, ''))
                 end;
  reachable  := to_address is not null;
  opt_out    := coalesce(
                  (select m.notifications_opt_out from public.members m where m.id = r.id),
                  false);
  locale     := public.org_notification_locale(r.org_id);

  -- Exactly the keys the sweeps build, so the same template renders the same
  -- sentence whether a cron job or the front desk sent it.
  vars := jsonb_build_object(
    'member_name', r.full_name,
    'name',        r.full_name,
    'gym_name',    r.org_name,
    'branch_name', coalesce(r.home_branch_name, r.org_name),
    'plan_name',   r.current_plan_name,
    'end_date',    to_char(r.membership_end_date, 'DD Mon YYYY'),
    'days_left',   greatest(coalesce(r.days_to_expiry, 0), 0)::text,
    'due_amount',  public.format_paisa(coalesce(r.due_paisa, 0)::bigint,
                                       coalesce(r.currency, 'NPR')),
    'email',       coalesce(r.email, '')
  );

  return next;
end;
$$;

revoke execute on function public.member_message_target(uuid, public.notification_channel)
  from public, anon, authenticated;

comment on function public.member_message_target(uuid, public.notification_channel) is
  'Internal: the guard and the template variables behind the manual send. Not callable by any client role.';

-- ---------------------------------------------------------------------------
-- what it would say, and whether it would go
-- ---------------------------------------------------------------------------

create or replace function public.member_notification_preview(
  p_member_id uuid,
  p_event public.notification_event,
  p_channel public.notification_channel default 'sms'
)
returns table (
  to_address text,
  subject text,
  body text,
  opt_out boolean,
  reachable boolean,
  has_gateway boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t record;
  tpl record;
begin
  select * into t from public.member_message_target(p_member_id, p_channel);

  to_address  := t.to_address;
  opt_out     := t.opt_out;
  reachable   := t.reachable;
  -- notification_providers is owner-only under RLS and the desk has to be told
  -- "there is no gateway" rather than shown a Send button that does nothing.
  has_gateway := exists (
    select 1 from public.notification_providers np
    where np.org_id = t.org_id and np.channel = p_channel and np.is_active
  );

  if p_event = 'custom_message'::public.notification_event then
    -- Nothing to render: the desk writes this one.
    subject := null;
    body    := null;
  else
    select * into tpl
      from public.resolve_notification_template(t.org_id, p_event, p_channel, t.locale);
    subject := public.render_notification_template(tpl.subject, t.vars);
    body    := public.render_notification_template(tpl.body, t.vars);
  end if;

  return next;
end;
$$;

revoke execute on function public.member_notification_preview(
  uuid, public.notification_event, public.notification_channel) from public, anon;
grant execute on function public.member_notification_preview(
  uuid, public.notification_event, public.notification_channel) to authenticated;

-- ---------------------------------------------------------------------------
-- the send
-- ---------------------------------------------------------------------------

create or replace function public.send_member_notification(
  p_member_id uuid,
  p_event public.notification_event,
  p_channel public.notification_channel default 'sms',
  p_body text default null,
  p_subject text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  tpl record;
  v_body text;
  v_subject text;
begin
  if p_event in ('staff_invite'::public.notification_event,
                 'test_message'::public.notification_event) then
    raise exception 'That message is not one the desk sends to a member'
      using errcode = 'check_violation';
  end if;

  select * into t from public.member_message_target(p_member_id, p_channel);

  -- Consent, and no override. A member who opted out did not mean "unless
  -- someone clicks the button".
  if t.opt_out then
    raise exception 'This member has asked not to receive messages'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.notification_providers np
    where np.org_id = t.org_id and np.channel = p_channel and np.is_active
  ) then
    raise exception 'There is no % gateway configured yet, so nothing would go out', p_channel
      using errcode = 'check_violation';
  end if;

  v_body := nullif(btrim(coalesce(p_body, '')), '');
  v_subject := nullif(btrim(coalesce(p_subject, '')), '');

  if v_body is null then
    if p_event = 'custom_message'::public.notification_event then
      raise exception 'Write the message first'
        using errcode = 'check_violation';
    end if;

    select * into tpl
      from public.resolve_notification_template(t.org_id, p_event, p_channel, t.locale);
    v_body := public.render_notification_template(tpl.body, t.vars);
    v_subject := coalesce(v_subject, public.render_notification_template(tpl.subject, t.vars));
  end if;

  if v_body is null or length(btrim(v_body)) = 0 then
    raise exception 'The message cannot be blank'
      using errcode = 'check_violation';
  end if;

  -- A double click costs a real SMS credit and reads, to the member, as the gym
  -- texting twice. The sweeps get this from their dedupe keys; a manual send
  -- has none, so the guard is a window instead.
  if exists (
    select 1 from public.notification_messages nm
    where nm.org_id = t.org_id
      and nm.member_id = p_member_id
      and nm.event = p_event
      and nm.channel = p_channel
      and nm.status in ('queued'::public.notification_status,
                        'sending'::public.notification_status)
      and nm.created_at > now() - interval '2 minutes'
  ) then
    raise exception 'That message is already queued for this member'
      using errcode = 'unique_violation';
  end if;

  -- One INSERT path into the outbox, still. Normalisation, the `skipped` row
  -- for an unusable number and the dedupe key all live there.
  return public.enqueue_notification(
    p_channel     => p_channel,
    p_event       => p_event,
    -- The raw number rather than the normalised one: `enqueue_notification`
    -- normalises anyway, and a log row saying what the desk actually had on
    -- file is what makes a bad number fixable.
    p_to          => coalesce(nullif(t.raw_address, ''), 'unknown'),
    p_body        => v_body,
    p_subject     => v_subject,
    p_member_id   => p_member_id,
    p_branch_id   => t.branch_id
  );
end;
$$;

revoke execute on function public.send_member_notification(
  uuid, public.notification_event, public.notification_channel, text, text)
  from public, anon;
grant execute on function public.send_member_notification(
  uuid, public.notification_event, public.notification_channel, text, text)
  to authenticated;

comment on function public.send_member_notification(
  uuid, public.notification_event, public.notification_channel, text, text) is
  'One message to one member, sent by hand by an owner, manager or front desk. Refuses an opted-out member.';
