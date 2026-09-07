-- Phase 5, part 1 of 6: the notification schema.
--
-- Four tables. Three of them are configuration an owner edits -- which gateway,
-- what the message says, and when it goes out -- and the fourth,
-- `notification_messages`, is both the outbox the sender drains and the
-- delivery log the console reads. One table for both, because a "delivery log"
-- that is a separate copy of the queue is a second source of truth about
-- whether a member was told something.
--
-- Renewal reminders at T-7 and T-1 are NOT two events. They are two
-- `notification_rules` rows for one `renewal_reminder` event with different
-- `offset_days`, so a chain that wants a T-3 adds a row rather than waiting for
-- a migration.
--
-- The gateway API token is deliberately absent from `notification_providers`.
-- It lives in supabase_vault under the name in `secret_name`, written by
-- `set_notification_credential` (part 2) and readable only by the sender. The
-- console can set a token and can never read one back.

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------

create type public.notification_channel as enum ('sms', 'viber', 'email');

create type public.notification_event as enum (
  'renewal_reminder',
  'dues_reminder',
  'birthday_greeting',
  'staff_invite',
  'test_message'
);

create type public.notification_provider as enum (
  'sparrow_sms',
  'aakash_sms',
  'viber_business',
  'resend_email',
  'custom_http',
  'log_only'
);

-- `skipped` is not a failure: it is "we deliberately did not send this", which
-- is what an unconfigured channel, an opted-out member or an unusable phone
-- number produces. Keeping it distinct from `failed` is what stops the retry
-- worker from hammering a message that was never going to leave.
create type public.notification_status as enum (
  'queued',
  'sending',
  'sent',
  'failed',
  'cancelled',
  'skipped'
);

-- ---------------------------------------------------------------------------
-- providers: one active gateway per channel per org
-- ---------------------------------------------------------------------------

create table public.notification_providers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  channel public.notification_channel not null,
  provider public.notification_provider not null,
  sender_id text,
  endpoint_url text,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  secret_name text,
  created_by uuid references public.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notification_providers_sender_len
    check (sender_id is null or length(btrim(sender_id)) between 1 and 32),

  -- A custom gateway must name an endpoint, and it must be TLS: the token
  -- travels in the request, and pg_net will happily speak plain http.
  constraint notification_providers_endpoint_shape
    check (
      case
        when provider = 'custom_http' then endpoint_url is not null and endpoint_url like 'https://%'
        else endpoint_url is null or endpoint_url like 'https://%'
      end
    ),
  constraint notification_providers_endpoint_len
    check (endpoint_url is null or length(endpoint_url) <= 400),
  constraint notification_providers_config_object
    check (jsonb_typeof(config) = 'object')
);

create unique index notification_providers_active_channel_idx
  on public.notification_providers (org_id, channel)
  where is_active;

create index notification_providers_org_idx
  on public.notification_providers (org_id);

create trigger notification_providers_set_updated_at
  before update on public.notification_providers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- templates: what the message says, per org
-- ---------------------------------------------------------------------------

create table public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  event public.notification_event not null,
  channel public.notification_channel not null,
  locale text not null default 'en',
  subject text,
  body text not null,
  is_active boolean not null default true,
  updated_by uuid references public.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notification_templates_locale check (locale in ('en', 'ne')),
  constraint notification_templates_body_len check (length(btrim(body)) between 1 and 1000),
  constraint notification_templates_subject_len
    check (subject is null or length(btrim(subject)) between 1 and 200),
  constraint notification_templates_unique unique (org_id, event, channel, locale)
);

create trigger notification_templates_set_updated_at
  before update on public.notification_templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- rules: whether, when, and how often
-- ---------------------------------------------------------------------------

create table public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  event public.notification_event not null,
  channel public.notification_channel not null,
  enabled boolean not null default true,
  -- renewal: days before end_date. dues: minimum age of the debt in days.
  -- birthday: unused, always 0.
  offset_days integer not null default 0,
  min_amount_paisa bigint not null default 0,
  -- dues only: do not chase the same member again inside this many days.
  repeat_after_days integer not null default 7,
  send_at_local time not null default '09:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notification_rules_offset check (offset_days between 0 and 365),
  constraint notification_rules_amount check (min_amount_paisa >= 0),
  constraint notification_rules_repeat check (repeat_after_days between 1 and 365),
  constraint notification_rules_unique unique (org_id, event, channel, offset_days)
);

create trigger notification_rules_set_updated_at
  before update on public.notification_rules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- messages: the outbox and the delivery log
-- ---------------------------------------------------------------------------

create table public.notification_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  branch_id uuid references public.branches (id) on delete set null,
  member_id uuid references public.members (id) on delete set null,
  staff_id uuid references public.staff (id) on delete set null,
  channel public.notification_channel not null,
  event public.notification_event not null,
  -- Resolved at send time, so a message queued before a gateway was configured
  -- still records which one eventually carried it.
  provider public.notification_provider,
  to_address text not null,
  subject text,
  -- Rendered at enqueue time, never at send time. Editing a template must not
  -- retroactively change what a member was told.
  body text not null,
  status public.notification_status not null default 'queued',
  attempts integer not null default 0,
  scheduled_for timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  request_id bigint,
  provider_status integer,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint notification_messages_to_len check (length(btrim(to_address)) between 3 and 254),
  constraint notification_messages_body_len check (length(btrim(body)) between 1 and 1000),
  constraint notification_messages_attempts check (attempts >= 0),

  constraint notification_messages_branch_fk
    foreign key (branch_id, org_id) references public.branches (id, org_id) on delete set null,
  constraint notification_messages_member_fk
    foreign key (member_id, org_id) references public.members (id, org_id) on delete set null,
  constraint notification_messages_staff_fk
    foreign key (staff_id, org_id) references public.staff (id, org_id) on delete set null,

  -- The idempotency key. Every enqueue job builds one deterministically, so a
  -- job that runs twice inserts once and nobody is texted twice.
  constraint notification_messages_dedupe unique (org_id, dedupe_key)
);

-- The worker's index: rows it might pick up next.
create index notification_messages_due_idx
  on public.notification_messages (next_attempt_at, id)
  where status in ('queued', 'sending');

create index notification_messages_org_idx
  on public.notification_messages (org_id, created_at desc);

create index notification_messages_member_idx
  on public.notification_messages (member_id, created_at desc)
  where member_id is not null;

create index notification_messages_request_idx
  on public.notification_messages (request_id)
  where request_id is not null;

create trigger notification_messages_set_updated_at
  before update on public.notification_messages
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.notification_providers enable row level security;
alter table public.notification_templates enable row level security;
alter table public.notification_rules enable row level security;
alter table public.notification_messages enable row level security;

-- Providers hold a gateway account and the name of a vault secret. Owner only,
-- read and write, matching /settings.
create policy "owners read notification providers" on public.notification_providers
  for select using (public.is_org_member(org_id) and public.jwt_is_staff() and public.jwt_is_owner());
create policy "owners insert notification providers" on public.notification_providers
  for insert with check (public.is_org_member(org_id) and public.jwt_is_staff() and public.jwt_is_owner());
create policy "owners update notification providers" on public.notification_providers
  for update using (public.is_org_member(org_id) and public.jwt_is_staff() and public.jwt_is_owner())
  with check (public.is_org_member(org_id) and public.jwt_is_staff() and public.jwt_is_owner());
create policy "owners delete notification providers" on public.notification_providers
  for delete using (public.is_org_member(org_id) and public.jwt_is_staff() and public.jwt_is_owner());

-- Templates and rules: any staff may read (the desk should be able to see what
-- the gym tells its members), only an owner may change them.
create policy "staff read notification templates" on public.notification_templates
  for select using (public.is_org_member(org_id) and public.jwt_is_staff());
create policy "owners write notification templates" on public.notification_templates
  for all using (public.is_org_member(org_id) and public.jwt_is_staff() and public.jwt_is_owner())
  with check (public.is_org_member(org_id) and public.jwt_is_staff() and public.jwt_is_owner());

create policy "staff read notification rules" on public.notification_rules
  for select using (public.is_org_member(org_id) and public.jwt_is_staff());
create policy "owners write notification rules" on public.notification_rules
  for all using (public.is_org_member(org_id) and public.jwt_is_staff() and public.jwt_is_owner())
  with check (public.is_org_member(org_id) and public.jwt_is_staff() and public.jwt_is_owner());

-- Messages are read-only to everyone. Every write goes through an RPC or the
-- cron worker, the same rule `class_bookings` follows.
create policy "staff read notification messages" on public.notification_messages
  for select using (
    public.is_org_member(org_id)
    and public.jwt_is_staff()
    and (
      public.jwt_is_owner()
      or public.jwt_staff_role() = 'manager'::public.staff_role
      or branch_id is null
      or public.has_branch_access(branch_id)
    )
  );

-- A member sees their own messages. The Flutter app gets the history for free,
-- and it is their message: they received it.
create policy "members read their own notification messages" on public.notification_messages
  for select using (public.jwt_is_member() and member_id = public.jwt_member_id());

-- ---------------------------------------------------------------------------
-- members: consent, and an index the birthday sweep needs
-- ---------------------------------------------------------------------------

-- Nothing in this repository has ever recorded whether a member wants to be
-- contacted, because nothing has ever contacted them. Sending automated SMS
-- with no way to stop is not shippable, so the flag ships with the sender.
alter table public.members
  add column notifications_opt_out boolean not null default false;

comment on column public.members.notifications_opt_out is
  'Member asked not to receive automated reminders. Checked by every enqueue job.';

-- `date_of_birth` has existed since the members table was created and nothing
-- has ever read it. The birthday sweep reads it once a day across the whole
-- table, so it gets an expression index rather than a seq scan.
create index members_birthday_idx
  on public.members (
    org_id,
    (extract(month from date_of_birth)),
    (extract(day from date_of_birth))
  )
  where date_of_birth is not null and archived_at is null;
