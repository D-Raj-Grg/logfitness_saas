-- The three acknowledgements, wired up: built-in wording, three rules off by
-- default, three triggers.
--
-- Every one of them rides an INSERT or an UPDATE rather than waiting for the
-- 02:30 sweep, for the reason `visitor_welcome` does: "thanks for your money"
-- arriving the following morning is a different, worse message. The one-minute
-- outbox worker carries them out.
--
-- Each trigger body is wrapped whole in an exception handler. A membership
-- sale and a cash receipt are the product; the SMS is a courtesy. A null
-- template or a mangled variable must never take the till down.
--
-- All three rules seed DISABLED, like the visitor rules and unlike the
-- original four. They arrive at gyms that already have a live gateway and a
-- table full of payments; switching them on here would start spending an
-- owner's SMS credit on a decision they never made. The settings screen has
-- the three checkboxes.

-- ---------------------------------------------------------------------------
-- the built-in wording
-- ---------------------------------------------------------------------------

-- Rewritten whole rather than appended to, because the function is one VALUES
-- list. The fourteen existing rows are unchanged; six are new.
--
-- None of the three defaults mentions `{{end_date}}`, `{{invoice_no}}` or
-- `{{due_amount}}`, though all three are bound. A session pack has no end
-- date, a payment taken against no invoice has no number, and a settled
-- balance reads "Rs 0" -- and a sentence with a hole in it, or a zero in it,
-- reads worse than one that never promised the detail. A gym that wants them
-- writes them into its own template.
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
     'नमस्ते {{visitor_name}}, {{gym_name}} {{branch_name}} मा भेट्न पाउँदा खुसी लाग्यो। सुरु गर्न मन भए जुनसुकै बेला हामीलाई सम्पर्क गर्नुहोस्।'),
    ('member_welcome', 'en', null,
     'Welcome to {{gym_name}}, {{member_name}}! Your {{plan_name}} is active from {{start_date}}. See you at {{branch_name}}.'),
    ('member_welcome', 'ne', null,
     '{{gym_name}} मा स्वागत छ, {{member_name}}! तपाईंको {{plan_name}} {{start_date}} बाट सक्रिय छ। {{branch_name}} मा भेटौं।'),
    ('payment_received', 'en', null,
     'Thank you {{member_name}}. {{gym_name}} {{branch_name}} has received {{amount}} on {{paid_on}}. Keep this message as your receipt.'),
    ('payment_received', 'ne', null,
     'धन्यवाद {{member_name}}। {{gym_name}} {{branch_name}} ले {{paid_on}} मा {{amount}} प्राप्त गर्‍यो। यो सन्देश रसिदको रूपमा राख्नुहोस्।'),
    ('dues_cleared', 'en', null,
     'Thank you {{member_name}} -- your {{gym_name}} account is fully settled. Nothing is outstanding.'),
    ('dues_cleared', 'ne', null,
     'धन्यवाद {{member_name}} -- {{gym_name}} मा तपाईंको हिसाब पूरा भयो। अब केही बाँकी छैन।')
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
-- the three rules, off until an owner says otherwise
-- ---------------------------------------------------------------------------

-- `offset_days` is 0 on all three and unused: none of them waits. It stays in
-- the insert because it is part of the uniqueness key.
--
-- `min_amount_paisa` IS used, by `payment_received` alone: a gym taking a
-- Rs 50 top-up does not necessarily want to spend an SMS on it. The settings
-- screen shows that box for this rule and for the dues reminder, nowhere else.
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
    (p_org_id, 'visitor_welcome',   'sms', false, 0, 0, 7),
    (p_org_id, 'visitor_follow_up', 'sms', false, 3, 0, 7),
    (p_org_id, 'member_welcome',    'sms', false, 0, 0, 7),
    (p_org_id, 'payment_received',  'sms', false, 0, 0, 7),
    (p_org_id, 'dues_cleared',      'sms', false, 0, 0, 7)
  on conflict (org_id, event, channel, offset_days) do nothing;
$$;

-- Backfill: every existing gym gets the three new rows, disabled. `on conflict
-- do nothing` leaves the six they already have exactly as the owner set them.
select public.seed_notification_rules(o.id) from public.orgs o;

-- ---------------------------------------------------------------------------
-- who may be texted at all
-- ---------------------------------------------------------------------------

-- The three sweeps each spell this out inline. Three more copies of it would
-- be three places to forget an opt-out, so it is one function: a member who
-- has asked not to be contacted, who has been archived, or who has left is not
-- texted, whatever the reason for the message.
create or replace function public.member_is_contactable(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.id = p_member_id
      and m.archived_at is null
      and not m.notifications_opt_out
      and m.status <> 'left'::public.member_status
  );
$$;

-- Internal. It reads any member row by id, definer-rights and with no tenant
-- check, because the three triggers that call it have already established the
-- org. Left executable by `authenticated` it would be a boolean oracle over
-- every gym's members: ask it about a uuid and learn whether that member
-- exists, is archived, or has opted out.
revoke execute on function public.member_is_contactable(uuid) from public, anon, authenticated;

comment on function public.member_is_contactable(uuid) is
  'False for an archived, departed or opted-out member. The one place the automatic sends agree on who may be written to.';

-- ---------------------------------------------------------------------------
-- the welcome, on the first membership
-- ---------------------------------------------------------------------------

-- On `memberships`, not on `members`: a member row can exist for a minute or a
-- week before anything is sold, and "welcome, your plan is active" is only
-- true once one is. The `not exists` is what keeps it a welcome rather than a
-- renewal receipt -- a member's second membership is not a joining.
create or replace function public.enqueue_member_welcome()
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
    -- Their second plan, or later. Nothing to welcome.
    if exists (
      select 1 from public.memberships m2
      where m2.member_id = new.member_id
        and m2.org_id = new.org_id
        and m2.id <> new.id
    ) then
      return new;
    end if;

    if not public.member_is_contactable(new.member_id) then
      return new;
    end if;

    select
      o.id as org_id, o.name as org_name,
      b.name as branch_name,
      m.full_name, m.phone, m.email,
      rule.channel
      into r
      from public.notification_rules rule
      join public.orgs o on o.id = rule.org_id
      join public.members m on m.id = new.member_id and m.org_id = o.id
      left join public.branches b on b.id = new.branch_id and b.org_id = o.id
     where rule.org_id = new.org_id
       and rule.event = 'member_welcome'::public.notification_event
       and rule.enabled
     limit 1;

    -- No rule, or the owner has it switched off.
    if not found then
      return new;
    end if;

    -- An org with no gateway is skipped entirely rather than accumulating
    -- "there is no gateway" rows, exactly as the sweeps do.
    if not exists (
      select 1 from public.notification_providers np
      where np.org_id = r.org_id and np.channel = r.channel and np.is_active
    ) then
      return new;
    end if;

    v_vars := jsonb_build_object(
      'member_name', r.full_name,
      'name',        r.full_name,
      'gym_name',    r.org_name,
      'branch_name', coalesce(r.branch_name, r.org_name),
      'plan_name',   new.plan_name,
      'start_date',  to_char(new.start_date, 'DD Mon YYYY'),
      'end_date',    coalesce(to_char(new.end_date, 'DD Mon YYYY'), ''),
      'email',       coalesce(r.email, '')
    );

    select * into tpl
      from public.resolve_notification_template(
        r.org_id, 'member_welcome'::public.notification_event, r.channel,
        public.org_notification_locale(r.org_id));

    v_body := public.render_notification_template(tpl.body, v_vars);
    if v_body is null or length(btrim(v_body)) = 0 then
      return new;
    end if;

    v_address := case r.channel
                   when 'email' then lower(nullif(btrim(r.email), ''))
                   else public.normalise_msisdn(r.phone)
                 end;

    insert into public.notification_messages (
      org_id, branch_id, member_id, channel, event, to_address, subject, body,
      status, last_error, dedupe_key
    )
    values (
      r.org_id, new.branch_id, new.member_id, r.channel, 'member_welcome',
      coalesce(v_address, btrim(coalesce(r.phone, 'unknown'))),
      public.render_notification_template(tpl.subject, v_vars),
      left(btrim(v_body), 1000),
      -- A number that will not normalise still gets a row, the sweeps' habit:
      -- the desk mistyped a digit and the log is where that becomes visible.
      case when v_address is null then 'skipped'::public.notification_status
           else 'queued'::public.notification_status end,
      case when v_address is null
           then 'No usable ' || r.channel::text || ' address for this member' end,
      -- Keyed on the member, not the membership: one welcome per person, even
      -- if the first sale is voided and re-entered.
      'member_welcome:' || new.member_id::text
    )
    on conflict (org_id, dedupe_key) do nothing;
  exception
    when others then
      -- Logged, not raised. The membership is sold either way.
      raise warning 'member welcome not queued for %: %', new.member_id, sqlerrm;
  end;

  return new;
end;
$$;

revoke execute on function public.enqueue_member_welcome() from public, anon, authenticated;

drop trigger if exists memberships_enqueue_welcome on public.memberships;

create trigger memberships_enqueue_welcome
  after insert on public.memberships
  for each row execute function public.enqueue_member_welcome();

-- ---------------------------------------------------------------------------
-- the receipt, on the payment
-- ---------------------------------------------------------------------------

-- Named to sort after `payments_sync_invoice`. Postgres fires row triggers of
-- the same timing in alphabetical order, and this one reads `due_paisa` off
-- the invoice: run before the sync and every receipt would quote the balance
-- as it stood before the money arrived.
--
-- Refunds are silent. A negative row is a correction between the desk and its
-- own books, and "thank you, we have received Rs -2,000" is not a sentence to
-- send anybody.
create or replace function public.enqueue_payment_received()
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
    if new.kind <> 'payment'::public.payment_kind then
      return new;
    end if;

    if not public.member_is_contactable(new.member_id) then
      return new;
    end if;

    select
      o.id as org_id, o.name as org_name, o.currency, o.timezone,
      b.name as branch_name,
      m.full_name, m.phone, m.email,
      i.invoice_no, i.due_paisa,
      rule.channel
      into r
      from public.notification_rules rule
      join public.orgs o on o.id = rule.org_id
      join public.members m on m.id = new.member_id and m.org_id = o.id
      left join public.branches b on b.id = new.branch_id and b.org_id = o.id
      left join public.invoices i on i.id = new.invoice_id and i.org_id = o.id
     where rule.org_id = new.org_id
       and rule.event = 'payment_received'::public.notification_event
       and rule.enabled
       -- The owner's floor: a Rs 50 top-up need not cost an SMS.
       and new.amount_paisa >= rule.min_amount_paisa
     limit 1;

    if not found then
      return new;
    end if;

    if not exists (
      select 1 from public.notification_providers np
      where np.org_id = r.org_id and np.channel = r.channel and np.is_active
    ) then
      return new;
    end if;

    v_vars := jsonb_build_object(
      'member_name', r.full_name,
      'name',        r.full_name,
      'gym_name',    r.org_name,
      'branch_name', coalesce(r.branch_name, r.org_name),
      'amount',      public.format_paisa(new.amount_paisa, coalesce(r.currency, 'NPR')),
      'due_amount',  public.format_paisa(greatest(coalesce(r.due_paisa, 0), 0),
                                         coalesce(r.currency, 'NPR')),
      'invoice_no',  coalesce(r.invoice_no, ''),
      'paid_on',     to_char(new.paid_at at time zone coalesce(r.timezone, 'UTC'), 'DD Mon YYYY'),
      'email',       coalesce(r.email, '')
    );

    select * into tpl
      from public.resolve_notification_template(
        r.org_id, 'payment_received'::public.notification_event, r.channel,
        public.org_notification_locale(r.org_id));

    v_body := public.render_notification_template(tpl.body, v_vars);
    if v_body is null or length(btrim(v_body)) = 0 then
      return new;
    end if;

    v_address := case r.channel
                   when 'email' then lower(nullif(btrim(r.email), ''))
                   else public.normalise_msisdn(r.phone)
                 end;

    insert into public.notification_messages (
      org_id, branch_id, member_id, channel, event, to_address, subject, body,
      status, last_error, dedupe_key
    )
    values (
      r.org_id, new.branch_id, new.member_id, r.channel, 'payment_received',
      coalesce(v_address, btrim(coalesce(r.phone, 'unknown'))),
      public.render_notification_template(tpl.subject, v_vars),
      left(btrim(v_body), 1000),
      case when v_address is null then 'skipped'::public.notification_status
           else 'queued'::public.notification_status end,
      case when v_address is null
           then 'No usable ' || r.channel::text || ' address for this member' end,
      'payment_received:' || new.id::text
    )
    on conflict (org_id, dedupe_key) do nothing;
  exception
    when others then
      -- Logged, not raised. The cash is recorded either way, and a receipt
      -- that failed to queue must never cost the gym the payment row.
      raise warning 'payment receipt not queued for %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke execute on function public.enqueue_payment_received() from public, anon, authenticated;

drop trigger if exists payments_then_enqueue_receipt on public.payments;

create trigger payments_then_enqueue_receipt
  after insert on public.payments
  for each row execute function public.enqueue_payment_received();

-- ---------------------------------------------------------------------------
-- the clearance, when an invoice reaches zero
-- ---------------------------------------------------------------------------

-- On `invoices`, not on `payments`, so that every route to a zero balance is
-- covered: the last instalment, a discount written in afterwards, a correction
-- made by hand. `sync_invoice_totals` updates the status, this reads it.
--
-- A zero-total invoice never gets here: it has no payment to sync, so it stays
-- `unpaid`, and "your Rs 0 is settled" is not worth a message.
create or replace function public.enqueue_dues_cleared()
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
    if new.status <> 'paid'::public.invoice_status
       or old.status = 'paid'::public.invoice_status
       or new.total_paisa <= 0 then
      return new;
    end if;

    if not public.member_is_contactable(new.member_id) then
      return new;
    end if;

    -- Still owing on something else. "Nothing is outstanding" would be a lie,
    -- so the message waits for the invoice that actually finishes it.
    if exists (
      select 1 from public.invoices i
      where i.member_id = new.member_id
        and i.org_id = new.org_id
        and i.id <> new.id
        and i.status in ('unpaid'::public.invoice_status,
                         'partial'::public.invoice_status)
        and i.due_paisa > 0
    ) then
      return new;
    end if;

    select
      o.id as org_id, o.name as org_name, o.currency,
      b.name as branch_name,
      m.full_name, m.phone, m.email,
      rule.channel
      into r
      from public.notification_rules rule
      join public.orgs o on o.id = rule.org_id
      join public.members m on m.id = new.member_id and m.org_id = o.id
      left join public.branches b on b.id = new.branch_id and b.org_id = o.id
     where rule.org_id = new.org_id
       and rule.event = 'dues_cleared'::public.notification_event
       and rule.enabled
     limit 1;

    if not found then
      return new;
    end if;

    if not exists (
      select 1 from public.notification_providers np
      where np.org_id = r.org_id and np.channel = r.channel and np.is_active
    ) then
      return new;
    end if;

    v_vars := jsonb_build_object(
      'member_name', r.full_name,
      'name',        r.full_name,
      'gym_name',    r.org_name,
      'branch_name', coalesce(r.branch_name, r.org_name),
      'invoice_no',  new.invoice_no,
      'amount',      public.format_paisa(new.total_paisa, coalesce(r.currency, 'NPR')),
      'email',       coalesce(r.email, '')
    );

    select * into tpl
      from public.resolve_notification_template(
        r.org_id, 'dues_cleared'::public.notification_event, r.channel,
        public.org_notification_locale(r.org_id));

    v_body := public.render_notification_template(tpl.body, v_vars);
    if v_body is null or length(btrim(v_body)) = 0 then
      return new;
    end if;

    v_address := case r.channel
                   when 'email' then lower(nullif(btrim(r.email), ''))
                   else public.normalise_msisdn(r.phone)
                 end;

    insert into public.notification_messages (
      org_id, branch_id, member_id, channel, event, to_address, subject, body,
      status, last_error, dedupe_key
    )
    values (
      r.org_id, new.branch_id, new.member_id, r.channel, 'dues_cleared',
      coalesce(v_address, btrim(coalesce(r.phone, 'unknown'))),
      public.render_notification_template(tpl.subject, v_vars),
      left(btrim(v_body), 1000),
      case when v_address is null then 'skipped'::public.notification_status
           else 'queued'::public.notification_status end,
      case when v_address is null
           then 'No usable ' || r.channel::text || ' address for this member' end,
      -- Keyed on the invoice alone: a refund that reopens it and a second
      -- payment that closes it again do not send this twice. The receipt for
      -- that second payment already says the money arrived.
      'dues_cleared:' || new.id::text
    )
    on conflict (org_id, dedupe_key) do nothing;
  exception
    when others then
      raise warning 'dues clearance not queued for invoice %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke execute on function public.enqueue_dues_cleared() from public, anon, authenticated;

drop trigger if exists invoices_enqueue_dues_cleared on public.invoices;

create trigger invoices_enqueue_dues_cleared
  after update of status on public.invoices
  for each row execute function public.enqueue_dues_cleared();
