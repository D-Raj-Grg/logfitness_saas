-- "Your plan is renewed" SMS.
--
-- Until now a renewal said nothing of its own: a paid one produced the generic
-- receipt, a Rs 0 one produced nothing, and no message named the plan or the
-- new dates. This sends one message that does all three, and stands in for the
-- receipt on a renewal so the member is not texted twice for one visit.
--
-- It is a constraint trigger, deferred to commit. renew_membership inserts the
-- membership first, then the invoice, then the payment; a plain AFTER INSERT
-- trigger would run before the money existed and could not say what was paid.

create or replace function public.notification_default_template(
  p_event public.notification_event,
  p_channel public.notification_channel,
  p_locale text default 'en'
)
returns table(subject text, body text)
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
     'धन्यवाद {{member_name}} -- {{gym_name}} मा तपाईंको हिसाब पूरा भयो। अब केही बाँकी छैन।'),
    -- {{period}} and {{payment_line}} are built by the trigger, so a session
    -- pack (no end date) and an unpaid renewal each read as a sentence.
    ('membership_renewed', 'en', null,
     'Hi {{member_name}}, your {{plan_name}} at {{gym_name}} is renewed {{period}}. {{payment_line}}'),
    ('membership_renewed', 'ne', null,
     'नमस्ते {{member_name}}, {{gym_name}} मा तपाईंको {{plan_name}} {{period}} नवीकरण भयो। {{payment_line}}')
  ) as t(event, locale, subject, body)
  where t.event = p_event::text
    and t.locale = case when p_locale in ('en', 'ne') then p_locale else 'en' end
  limit 1;
$$;

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
    (p_org_id, 'dues_cleared',      'sms', false, 0, 0, 7),
    (p_org_id, 'membership_renewed','sms', false, 0, 0, 7)
  on conflict (org_id, event, channel, offset_days) do nothing;
$$;

-- Off for every org, then on for the one gym that asked for it. The rest
-- decide for themselves in Settings > Notifications.
select public.seed_notification_rules(o.id) from public.orgs o;

update public.notification_rules
   set enabled = true
 where org_id = '597b0fd6-263a-43c9-8c80-2c64e1b18591'
   and event = 'membership_renewed';

create or replace function public.enqueue_membership_renewed()
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
  v_locale text;
  v_paid bigint;
  v_total bigint;
  v_due bigint;
  v_period text;
  v_payment_line text;
  v_money_paid text;
  v_money_due text;
begin
  begin
    -- Their first plan. The welcome covers it.
    if not exists (
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
       and rule.event = 'membership_renewed'::public.notification_event
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

    -- Deferred to commit, so the invoice and any payment exist by now.
    select coalesce(sum(p.amount_paisa), 0) into v_paid
      from public.payments p
     where p.membership_id = new.id
       and p.kind = 'payment'::public.payment_kind;

    select coalesce(sum(i.total_paisa), 0) into v_total
      from public.invoices i
     where i.membership_id = new.id;

    v_due := greatest(v_total - v_paid, 0);
    v_locale := public.org_notification_locale(r.org_id);
    v_money_paid := public.format_paisa(v_paid, coalesce(r.currency, 'NPR'));
    v_money_due := public.format_paisa(v_due, coalesce(r.currency, 'NPR'));

    if v_locale = 'ne' then
      v_period := case
        when new.end_date is null
          then to_char(new.start_date, 'DD Mon YYYY') || ' देखि'
        else to_char(new.start_date, 'DD Mon YYYY') || ' देखि '
             || to_char(new.end_date, 'DD Mon YYYY') || ' सम्म'
      end;
      v_payment_line := case
        when v_paid > 0 and v_due = 0 then v_money_paid || ' प्राप्त भयो, धन्यवाद।'
        when v_paid > 0 then v_money_paid || ' प्राप्त भयो; ' || v_money_due || ' बाँकी छ।'
        when v_due > 0 then v_money_due || ' बाँकी छ।'
        else 'धन्यवाद।'
      end;
    else
      v_period := case
        when new.end_date is null then 'from ' || to_char(new.start_date, 'DD Mon YYYY')
        else 'from ' || to_char(new.start_date, 'DD Mon YYYY')
             || ' to ' || to_char(new.end_date, 'DD Mon YYYY')
      end;
      v_payment_line := case
        when v_paid > 0 and v_due = 0 then 'Received ' || v_money_paid || ', thank you.'
        when v_paid > 0 then 'Received ' || v_money_paid || '; ' || v_money_due || ' is still due.'
        when v_due > 0 then v_money_due || ' is due.'
        else 'Thank you.'
      end;
    end if;

    v_vars := jsonb_build_object(
      'member_name',  r.full_name,
      'name',         r.full_name,
      'gym_name',     r.org_name,
      'branch_name',  coalesce(r.branch_name, r.org_name),
      'plan_name',    new.plan_name,
      'start_date',   to_char(new.start_date, 'DD Mon YYYY'),
      'end_date',     coalesce(to_char(new.end_date, 'DD Mon YYYY'), ''),
      'period',       v_period,
      'amount',       v_money_paid,
      'due_amount',   v_money_due,
      'payment_line', v_payment_line,
      'email',        coalesce(r.email, '')
    );

    select * into tpl
      from public.resolve_notification_template(
        r.org_id, 'membership_renewed'::public.notification_event, r.channel,
        v_locale);

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
      r.org_id, new.branch_id, new.member_id, r.channel, 'membership_renewed',
      coalesce(v_address, btrim(coalesce(r.phone, 'unknown'))),
      public.render_notification_template(tpl.subject, v_vars),
      left(btrim(v_body), 1000),
      case when v_address is null then 'skipped'::public.notification_status
           else 'queued'::public.notification_status end,
      case when v_address is null
           then 'No usable ' || r.channel::text || ' address for this member' end,
      -- Keyed on the membership: each renewal is its own message, and a retried
      -- commit cannot send the same one twice.
      'membership_renewed:' || new.id::text
    )
    on conflict (org_id, dedupe_key) do nothing;
  exception
    when others then
      -- Logged, not raised. The membership is sold either way.
      raise warning 'membership renewal not queued for %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke execute on function public.enqueue_membership_renewed() from public, anon, authenticated;

create constraint trigger memberships_enqueue_renewed
  after insert on public.memberships
  deferrable initially deferred
  for each row execute function public.enqueue_membership_renewed();

-- The receipt for a renewal's payment is now said by the renewal message.
-- Everything else about the receipt is as it was: a standalone payment toward
-- dues, a first membership (which gets the welcome), or an org that has not
-- switched the renewal message on still gets it.
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

    -- Taken at the same moment as a renewal and the renewal message is on:
    -- that message carries the amount, so a second text would be a duplicate.
    if new.membership_id is not null
       and exists (
         select 1 from public.memberships ms
         where ms.id = new.membership_id
           and ms.created_at = transaction_timestamp()
           and exists (
             select 1 from public.memberships ms2
             where ms2.member_id = ms.member_id
               and ms2.org_id = ms.org_id
               and ms2.id <> ms.id
           )
       )
       and exists (
         select 1 from public.notification_rules rr
         where rr.org_id = new.org_id
           and rr.event = 'membership_renewed'::public.notification_event
           and rr.enabled
       )
       and exists (
         select 1 from public.notification_providers np
         where np.org_id = new.org_id and np.is_active
       ) then
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
