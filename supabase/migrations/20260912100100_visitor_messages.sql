-- Texting the walk-in: automatically when they are logged, again a few days
-- later, and by hand whenever the desk decides to.
--
-- The shape is the one the member side already has, because a visitor message
-- is not a different kind of message -- it is the same outbox, the same
-- gateway, the same one-minute worker, the same delivery log. What is new is
-- only the recipient: somebody with no membership, no invoice and no
-- `members` row.
--
-- Five additions:
--
--   notification_messages.visitor_id   who it was about, so "has this walk-in
--                                      been texted" has an answer at all.
--   enqueue_visitor_welcome            a trigger on `visitors`. Immediate,
--                                      because "thanks for coming in" three
--                                      days late is a different message.
--   enqueue_visitor_follow_ups         the nightly sweep, in the shape the
--                                      other three sweeps set.
--   visitor_message_target             the guard and the variables behind the
--                                      manual send. Internal.
--   visitor_notification_preview
--   send_visitor_notification          preview and send, mirroring
--                                      member_notification_preview and
--                                      send_member_notification exactly.
--
-- Consent: `visitors` has no opt-out column and this migration does not add
-- one. A walk-in gave the desk their number minutes ago for exactly this; a
-- member's `notifications_opt_out` is a standing instruction accumulated over
-- a membership. If a visitor asks not to be contacted the desk marks them
-- "not joining", which takes them out of the follow-up sweep.
--
-- Both rules seed DISABLED, unlike the member rules, which seed enabled. Those
-- shipped with the feature; these arrive at gyms that already have a live
-- gateway and a visitor log full of rows, and switching them on here would
-- start spending an owner's SMS credit on a decision they never made. The
-- settings screen has the two checkboxes.

-- ---------------------------------------------------------------------------
-- who the message was about
-- ---------------------------------------------------------------------------

alter table public.notification_messages
  add column if not exists visitor_id uuid;

-- Composite, like every other tenant-scoped foreign key here: the pair is what
-- makes it impossible to point a row at another org's visitor. `set null`
-- rather than cascade -- deleting the visitor record does not unsend the text,
-- and the log row is the evidence that it went.
alter table public.notification_messages
  drop constraint if exists notification_messages_visitor_fk;

alter table public.notification_messages
  add constraint notification_messages_visitor_fk
    foreign key (visitor_id, org_id)
    references public.visitors (id, org_id) on delete set null;

create index if not exists notification_messages_visitor_idx
  on public.notification_messages (visitor_id, created_at desc)
  where visitor_id is not null;

comment on column public.notification_messages.visitor_id is
  'The walk-in this was about. Null for anything addressed to a member or to staff.';

-- ---------------------------------------------------------------------------
-- the outbox's single INSERT path learns about visitors
-- ---------------------------------------------------------------------------

-- A parameter cannot be added by `create or replace`, and leaving the old
-- nine-argument function in place beside a ten-argument one would make every
-- existing call ambiguous. Dropped and rebuilt instead; the body is the one
-- 20260912094100 left, plus `p_visitor_id`.
drop function if exists public.enqueue_notification(
  public.notification_channel, public.notification_event, text, text, text,
  uuid, uuid, uuid, text
);

create or replace function public.enqueue_notification(
  p_channel public.notification_channel,
  p_event public.notification_event,
  p_to text,
  p_body text,
  p_subject text default null,
  p_member_id uuid default null,
  p_staff_id uuid default null,
  p_branch_id uuid default null,
  p_dedupe_key text default null,
  p_visitor_id uuid default null
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

  if p_visitor_id is not null and not exists (
    select 1 from public.visitors v where v.id = p_visitor_id and v.org_id = v_org
  ) then
    raise exception 'That visitor is not in your gym'
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
    org_id, branch_id, member_id, staff_id, visitor_id, created_by, channel,
    event, to_address, subject, body, status, last_error, dedupe_key
  )
  values (
    v_org, p_branch_id, p_member_id, p_staff_id, p_visitor_id, v_actor,
    p_channel, p_event,
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
  uuid, uuid, uuid, text, uuid
) from public, anon;
grant execute on function public.enqueue_notification(
  public.notification_channel, public.notification_event, text, text, text,
  uuid, uuid, uuid, text, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- the built-in wording
-- ---------------------------------------------------------------------------

-- Rewritten whole rather than appended to, because the function is one VALUES
-- list. The ten existing rows are unchanged; four are new.
--
-- Neither default mentions `{{plan_name}}`. A walk-in who asked about nothing
-- in particular has no interested plan, and a sentence with a hole in it reads
-- worse than one that never promised the detail. The variable is still bound,
-- so a gym that wants it can write it into its own template.
create or replace function public.notification_default_template(
  p_event public.notification_event,
  p_channel public.notification_channel,
  p_locale text default 'en'
)
returns table (subject text, body text)
language sql
immutable
set search_path = ''
as $$
  select t.subject, t.body from (values
    ('renewal_reminder', 'en', null::text,
     'Hi {{member_name}}, your {{plan_name}} at {{gym_name}} ends on {{end_date}}. Renew at {{branch_name}} to keep training.'),
    ('renewal_reminder', 'ne', null,
     'नमस्ते {{member_name}}, {{gym_name}} मा तपाईंको {{plan_name}} {{end_date}} मा सकिँदैछ। नवीकरणका लागि {{branch_name}} मा सम्पर्क गर्नुहोस्।'),
    ('dues_reminder', 'en', null,
     'Hi {{member_name}}, {{due_amount}} is still outstanding on your {{gym_name}} membership. Please settle it at {{branch_name}}.'),
    ('dues_reminder', 'ne', null,
     'नमस्ते {{member_name}}, {{gym_name}} मा तपाईंको {{due_amount}} बाँकी छ। कृपया {{branch_name}} मा भुक्तानी गर्नुहोस्।'),
    ('birthday_greeting', 'en', null,
     'Happy birthday, {{member_name}}! Everyone at {{gym_name}} wishes you a great year ahead.'),
    ('birthday_greeting', 'ne', null,
     'जन्मदिनको हार्दिक शुभकामना, {{member_name}}! {{gym_name}} परिवारको तर्फबाट शुभकामना।'),
    ('staff_invite', 'en', 'You have been invited to {{gym_name}}',
     '{{member_name}}, you have been invited to join {{gym_name}} on Lord of Gyms. Sign up with this email address to accept: {{email}}'),
    ('staff_invite', 'ne', 'तपाईंलाई {{gym_name}} मा निमन्त्रणा गरिएको छ',
     '{{member_name}}, तपाईंलाई {{gym_name}} मा सामेल हुन निमन्त्रणा गरिएको छ। स्वीकार गर्न यही इमेल ({{email}}) बाट दर्ता गर्नुहोस्।'),
    ('test_message', 'en', 'Test message from {{gym_name}}',
     'This is a test message from {{gym_name}}. If you are reading it, the gateway works.'),
    ('test_message', 'ne', '{{gym_name}} बाट परीक्षण सन्देश',
     'यो {{gym_name}} बाट पठाइएको परीक्षण सन्देश हो। यो प्राप्त भयो भने ग्याटवे ठीक छ।'),
    ('visitor_welcome', 'en', null,
     'Hi {{visitor_name}}, thanks for visiting {{gym_name}} {{branch_name}} today. Call us any time -- we would be glad to have you training with us.'),
    ('visitor_welcome', 'ne', null,
     'नमस्ते {{visitor_name}}, आज {{gym_name}} {{branch_name}} मा आउनुभएकोमा धन्यवाद। कुनै जिज्ञासा भए हामीलाई सम्पर्क गर्नुहोस् -- तपाईंलाई हाम्रो जिममा स्वागत छ।'),
    ('visitor_follow_up', 'en', null,
     'Hi {{visitor_name}}, it was good to meet you at {{gym_name}} {{branch_name}}. Still thinking it over? We are here whenever you are ready to start.'),
    ('visitor_follow_up', 'ne', null,
     'नमस्ते {{visitor_name}}, {{gym_name}} {{branch_name}} मा भेट्न पाउँदा खुसी लाग्यो। सुरु गर्न मन भए जुनसुकै बेला हामीलाई सम्पर्क गर्नुहोस्।')
  ) as t(event, locale, subject, body)
  where t.event = p_event::text
    and t.locale = case when p_locale in ('en', 'ne') then p_locale else 'en' end
  limit 1;
$$;

revoke execute on function public.notification_default_template(
  public.notification_event, public.notification_channel, text) from public, anon;
grant execute on function public.notification_default_template(
  public.notification_event, public.notification_channel, text) to authenticated;

-- ---------------------------------------------------------------------------
-- the two rules, off until an owner says otherwise
-- ---------------------------------------------------------------------------

create or replace function public.seed_notification_rules(p_org_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notification_rules (org_id, event, channel, enabled, offset_days, min_amount_paisa, repeat_after_days)
  values
    (p_org_id, 'renewal_reminder',  'sms', true,  7, 0, 7),
    (p_org_id, 'renewal_reminder',  'sms', true,  1, 0, 7),
    (p_org_id, 'dues_reminder',     'sms', true,  3, 0, 7),
    (p_org_id, 'birthday_greeting', 'sms', true,  0, 0, 7),
    -- Off by default, and deliberately: see the header. `offset_days` on the
    -- welcome is unused (it fires on the insert); on the follow-up it is days
    -- since the visit, and three is the first day the gym is not the last
    -- thing they did.
    (p_org_id, 'visitor_welcome',   'sms', false, 0, 0, 7),
    (p_org_id, 'visitor_follow_up', 'sms', false, 3, 0, 7)
  on conflict (org_id, event, channel, offset_days) do nothing;
$$;

-- Backfill: every existing gym gets the two new rows, disabled. `on conflict
-- do nothing` leaves the four they already have exactly as the owner set them.
select public.seed_notification_rules(o.id) from public.orgs o;

-- ---------------------------------------------------------------------------
-- the welcome, on the insert
-- ---------------------------------------------------------------------------

-- Not a sweep. "Thanks for coming in" arriving at 02:30 the following morning
-- is a different, worse message, so this one rides the insert and the
-- one-minute worker carries it out within the minute.
--
-- The whole body is inside an exception handler. A visitor being logged at the
-- desk must never fail because of a text: the log is the product, the SMS is a
-- courtesy, and a null template or a mangled variable cannot be allowed to
-- take the counter down.
create or replace function public.enqueue_visitor_welcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  tpl record;
  v_vars jsonb;
  v_address text;
  v_body text;
begin
  begin
    select
      o.id as org_id, o.name as org_name,
      b.name as branch_name,
      p.name as plan_name,
      rule.channel
      into r
      from public.notification_rules rule
      join public.orgs o on o.id = rule.org_id
      left join public.branches b on b.id = new.branch_id and b.org_id = o.id
      left join public.membership_plans p
             on p.id = new.interested_plan_id and p.org_id = o.id
     where rule.org_id = new.org_id
       and rule.event = 'visitor_welcome'::public.notification_event
       and rule.enabled
     limit 1;

    -- No rule, or the owner has it switched off.
    if not found then
      return new;
    end if;

    -- An org with no gateway is skipped entirely rather than accumulating
    -- "there is no gateway" rows, exactly as the three sweeps do.
    if not exists (
      select 1 from public.notification_providers np
      where np.org_id = r.org_id and np.channel = r.channel and np.is_active
    ) then
      return new;
    end if;

    v_vars := jsonb_build_object(
      'visitor_name', new.full_name,
      'name',         new.full_name,
      'gym_name',     r.org_name,
      'branch_name',  coalesce(r.branch_name, r.org_name),
      'plan_name',    coalesce(r.plan_name, ''),
      'visited_on',   to_char(new.visited_on, 'DD Mon YYYY')
    );

    select * into tpl
      from public.resolve_notification_template(
        r.org_id, 'visitor_welcome'::public.notification_event, r.channel,
        public.org_notification_locale(r.org_id));

    v_body := public.render_notification_template(tpl.body, v_vars);
    if v_body is null or length(btrim(v_body)) = 0 then
      return new;
    end if;

    v_address := case r.channel
                   when 'email' then null
                   else public.normalise_msisdn(new.phone)
                 end;

    insert into public.notification_messages (
      org_id, branch_id, visitor_id, channel, event, to_address, subject, body,
      status, last_error, dedupe_key
    )
    values (
      r.org_id, new.branch_id, new.id, r.channel, 'visitor_welcome',
      coalesce(v_address, btrim(coalesce(new.phone, 'unknown'))),
      public.render_notification_template(tpl.subject, v_vars),
      left(btrim(v_body), 1000),
      -- A number that will not normalise still gets a row, the sweeps' habit:
      -- the desk mistyped a digit and the log is where that becomes visible.
      case when v_address is null then 'skipped'::public.notification_status
           else 'queued'::public.notification_status end,
      case when v_address is null
           then 'No usable ' || r.channel::text || ' address for this visitor' end,
      'visitor_welcome:' || new.id::text
    )
    on conflict (org_id, dedupe_key) do nothing;
  exception
    when others then
      -- Logged, not raised. The visit is recorded either way.
      raise warning 'visitor welcome not queued for %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke execute on function public.enqueue_visitor_welcome() from public, anon, authenticated;

drop trigger if exists visitors_enqueue_welcome on public.visitors;

create trigger visitors_enqueue_welcome
  after insert on public.visitors
  for each row execute function public.enqueue_visitor_welcome();

-- ---------------------------------------------------------------------------
-- the follow-up, on the nightly sweep
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_visitor_follow_ups()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  with candidate as (
    select
      rule.channel, rule.send_at_local, rule.offset_days,
      o.id as org_id, o.name as org_name, o.timezone,
      public.org_today(o.id) as today,
      v.id as visitor_id, v.full_name, v.phone, v.branch_id,
      b.name as branch_name,
      p.name as plan_name
    from public.notification_rules rule
    join public.orgs o on o.id = rule.org_id
    join public.visitors v on v.org_id = o.id
    left join public.branches b on b.id = v.branch_id and b.org_id = o.id
    left join public.membership_plans p on p.id = v.interested_plan_id and p.org_id = o.id
    where rule.event = 'visitor_follow_up'
      and rule.enabled
      and v.visited_on = public.org_today(o.id) - rule.offset_days
      -- Converted is a member now and gets the member's messages instead.
      -- "Not joining" said no, and chasing them anyway is what makes a gym
      -- look like a call centre.
      and v.status in ('new'::public.visitor_status, 'contacted'::public.visitor_status)
      and exists (
        select 1 from public.notification_providers np
        where np.org_id = o.id and np.channel = rule.channel and np.is_active
      )
  ),
  rendered as (
    select
      c.*,
      tpl.subject as tpl_subject,
      tpl.body    as tpl_body,
      jsonb_build_object(
        'visitor_name', c.full_name,
        'name',         c.full_name,
        'gym_name',     c.org_name,
        'branch_name',  coalesce(c.branch_name, c.org_name),
        'plan_name',    coalesce(c.plan_name, ''),
        'visited_on',   to_char(c.today - c.offset_days, 'DD Mon YYYY')
      ) as vars,
      case c.channel
        when 'email' then null
        else public.normalise_msisdn(c.phone)
      end as usable_address
    from candidate c
    cross join lateral public.resolve_notification_template(
      c.org_id, 'visitor_follow_up'::public.notification_event, c.channel,
      public.org_notification_locale(c.org_id)
    ) tpl
  )
  insert into public.notification_messages (
    org_id, branch_id, visitor_id, channel, event, to_address, subject, body,
    status, last_error, scheduled_for, next_attempt_at, dedupe_key
  )
  select
    r.org_id, r.branch_id, r.visitor_id, r.channel, 'visitor_follow_up',
    coalesce(r.usable_address, btrim(coalesce(r.phone, 'unknown'))),
    public.render_notification_template(r.tpl_subject, r.vars),
    public.render_notification_template(r.tpl_body, r.vars),
    case when r.usable_address is null then 'skipped'::public.notification_status
         else 'queued'::public.notification_status end,
    case when r.usable_address is null
         then 'No usable ' || r.channel::text || ' address for this visitor' end,
    (r.today + r.send_at_local) at time zone coalesce(r.timezone, 'Asia/Kathmandu'),
    (r.today + r.send_at_local) at time zone coalesce(r.timezone, 'Asia/Kathmandu'),
    -- One follow-up per visit, ever. The visitor id alone is the key: a gym
    -- that changes the offset from three days to five must not produce a
    -- second text to somebody who already had one.
    'visitor_follow_up:' || r.visitor_id::text
  from rendered r
  on conflict (org_id, dedupe_key) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.enqueue_visitor_follow_ups() from public, anon, authenticated;

create or replace function public.enqueue_notifications()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_renewal integer;
  v_dues integer;
  v_birthday integer;
  v_visitor integer;
begin
  v_renewal  := public.enqueue_renewal_reminders();
  v_dues     := public.enqueue_dues_reminders();
  v_birthday := public.enqueue_birthday_greetings();
  v_visitor  := public.enqueue_visitor_follow_ups();

  return jsonb_build_object(
    'renewal_reminder',  v_renewal,
    'dues_reminder',     v_dues,
    'birthday_greeting', v_birthday,
    'visitor_follow_up', v_visitor
  );
end;
$$;

revoke execute on function public.enqueue_notifications() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- the visitor, and every reason the desk may or may not message them
-- ---------------------------------------------------------------------------

-- The mirror of `member_message_target`: internal, definer, callable by no
-- client role, raising sentences rather than codes so the preview and the send
-- cannot drift apart.
create or replace function public.visitor_message_target(
  p_visitor_id uuid,
  p_channel public.notification_channel default 'sms'
)
returns table (
  org_id uuid,
  branch_id uuid,
  full_name text,
  to_address text,
  raw_address text,
  reachable boolean,
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
    raise exception 'Only staff can message a visitor'
      using errcode = 'insufficient_privilege';
  end if;

  -- The same line the member send draws. A trainer logs a walk-in -- every
  -- role may -- but texting one is the desk's job.
  if v_role not in ('owner'::public.staff_role,
                    'manager'::public.staff_role,
                    'front_desk'::public.staff_role) then
    raise exception 'Your role cannot send messages to visitors'
      using errcode = 'insufficient_privilege';
  end if;

  select v.*, o.name as org_name, b.name as branch_name, p.name as plan_name
    into r
    from public.visitors v
    join public.orgs o on o.id = v.org_id
    left join public.branches b on b.id = v.branch_id and b.org_id = v.org_id
    left join public.membership_plans p
           on p.id = v.interested_plan_id and p.org_id = v.org_id
   where v.id = p_visitor_id
     and v.org_id = v_org;

  if not found then
    raise exception 'That visitor is not in your gym'
      using errcode = 'no_data_found';
  end if;

  -- Once they have joined they are a member, with a member's history, a
  -- member's opt-out and a member's messages. Sending from here would write a
  -- row their profile never shows.
  if r.status = 'converted'::public.visitor_status then
    raise exception 'That visitor is a member now -- message them from their profile'
      using errcode = 'check_violation';
  end if;

  if not public.has_branch_access(r.branch_id) then
    raise exception 'That visitor walked into a branch outside your access'
      using errcode = 'insufficient_privilege';
  end if;

  org_id      := r.org_id;
  branch_id   := r.branch_id;
  full_name   := r.full_name;
  to_address  := case p_channel
                   when 'email' then null
                   else public.normalise_msisdn(r.phone)
                 end;
  raw_address := btrim(coalesce(r.phone, ''));
  reachable   := to_address is not null;
  locale      := public.org_notification_locale(r.org_id);

  -- The keys the trigger and the sweep build, so a welcome sent by hand reads
  -- exactly like the automatic one.
  vars := jsonb_build_object(
    'visitor_name', r.full_name,
    'name',         r.full_name,
    'gym_name',     r.org_name,
    'branch_name',  coalesce(r.branch_name, r.org_name),
    'plan_name',    coalesce(r.plan_name, ''),
    'visited_on',   to_char(r.visited_on, 'DD Mon YYYY')
  );

  return next;
end;
$$;

revoke execute on function public.visitor_message_target(uuid, public.notification_channel)
  from public, anon, authenticated;

comment on function public.visitor_message_target(uuid, public.notification_channel) is
  'Internal: the guard and the template variables behind a manual visitor send. Not callable by any client role.';

-- ---------------------------------------------------------------------------
-- what it would say, and whether it would go
-- ---------------------------------------------------------------------------

create or replace function public.visitor_notification_preview(
  p_visitor_id uuid,
  p_event public.notification_event,
  p_channel public.notification_channel default 'sms'
)
returns table (
  to_address text,
  subject text,
  body text,
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
  select * into t from public.visitor_message_target(p_visitor_id, p_channel);

  to_address  := t.to_address;
  reachable   := t.reachable;
  has_gateway := exists (
    select 1 from public.notification_providers np
    where np.org_id = t.org_id and np.channel = p_channel and np.is_active
  );

  if p_event = 'custom_message'::public.notification_event then
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

revoke execute on function public.visitor_notification_preview(
  uuid, public.notification_event, public.notification_channel) from public, anon;
grant execute on function public.visitor_notification_preview(
  uuid, public.notification_event, public.notification_channel) to authenticated;

-- ---------------------------------------------------------------------------
-- the send
-- ---------------------------------------------------------------------------

create or replace function public.send_visitor_notification(
  p_visitor_id uuid,
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
  -- A visitor is not owed a dues reminder or a birthday greeting: the product
  -- holds neither figure for them. Three events, and the screen offers the
  -- same three.
  if p_event not in ('visitor_welcome'::public.notification_event,
                     'visitor_follow_up'::public.notification_event,
                     'custom_message'::public.notification_event) then
    raise exception 'That message is not one the desk sends to a visitor'
      using errcode = 'check_violation';
  end if;

  select * into t from public.visitor_message_target(p_visitor_id, p_channel);

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

  -- The same two-minute window the member send uses. A double click costs a
  -- real credit and reads, to the visitor, as the gym texting twice.
  if exists (
    select 1 from public.notification_messages nm
    where nm.org_id = t.org_id
      and nm.visitor_id = p_visitor_id
      and nm.event = p_event
      and nm.channel = p_channel
      and nm.status in ('queued'::public.notification_status,
                        'sending'::public.notification_status)
      and nm.created_at > now() - interval '2 minutes'
  ) then
    raise exception 'That message is already queued for this visitor'
      using errcode = 'unique_violation';
  end if;

  return public.enqueue_notification(
    p_channel     => p_channel,
    p_event       => p_event,
    p_to          => coalesce(nullif(t.raw_address, ''), 'unknown'),
    p_body        => v_body,
    p_subject     => v_subject,
    p_branch_id   => t.branch_id,
    p_visitor_id  => p_visitor_id
  );
end;
$$;

revoke execute on function public.send_visitor_notification(
  uuid, public.notification_event, public.notification_channel, text, text)
  from public, anon;
grant execute on function public.send_visitor_notification(
  uuid, public.notification_event, public.notification_channel, text, text)
  to authenticated;

comment on function public.send_visitor_notification(
  uuid, public.notification_event, public.notification_channel, text, text) is
  'One message to one walk-in, sent by hand by an owner, manager or front desk.';
