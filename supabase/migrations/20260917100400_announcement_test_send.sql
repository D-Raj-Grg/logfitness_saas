-- Send one to yourself first.
--
-- An announcement is the one message here that cannot be taken back once it is
-- wrong, and the things that go wrong are not caught by reading it on screen:
-- a template variable that renders empty, a Devanagari sentence that arrives
-- as three messages, a sender ID the operator has not registered. All three
-- are obvious on a handset and invisible in a textarea.
--
-- So: one number, typed by hand, and the same rendering path the real send
-- uses. Deliberately *not* tied to an announcement row -- nothing has been
-- announced yet, and a test that appeared in the log as a broadcast to one
-- person would be a worse record than no record. It is an outbox row with
-- `announcement_id` null, which is what the delivery log already knows how to
-- show.
--
-- Not `test_message` either: that event exists for the owner's gateway check
-- on `/settings/notifications` and renders the gateway's own wording. This has
-- to render what the members are going to get, or it is testing the wrong
-- sentence.

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
  if v_org is null or v_actor is null or not public.jwt_is_staff()
     or public.jwt_staff_role() not in ('owner'::public.staff_role, 'manager'::public.staff_role) then
    raise exception 'Only an owner or manager can send an announcement'
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
