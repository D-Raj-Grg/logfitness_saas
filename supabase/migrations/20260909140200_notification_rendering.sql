-- Phase 5, part 3 of 6: turning a row into a sentence.
--
-- Three concerns, all pure functions with no network and no writes, so the SQL
-- gate can assert them directly:
--
--   normalise_msisdn      a phone number the gateway will accept, or null
--   render_notification_template   {{placeholder}} substitution
--   resolve_notification_template  the org's wording, else the built-in
--
-- `members.phone` is free text (5-32 chars, digits/spaces/+/-) under a
-- `unique (org_id, phone)` constraint, so two rows can hold 9812345678 and
-- +9779812345678 for the same human today. Normalising the column in place
-- could therefore collide two real members. Normalisation happens at enqueue
-- time instead, into the message's own `to_address`; a number that will not
-- normalise produces a `skipped` message that says so, which someone can see
-- and fix.

create or replace function public.normalise_msisdn(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p_phone is null then
    return null;
  end if;

  -- Everything that is not a digit goes, including the leading +.
  v := regexp_replace(p_phone, '[^0-9]', '', 'g');

  -- 977 is Nepal. Strip it however it was written: 00977, +977, 977.
  if v like '00977%' then
    v := substring(v from 6);
  elsif v like '977%' and length(v) > 10 then
    v := substring(v from 4);
  end if;

  -- Every Nepali mobile is ten digits beginning with 9. A landline, a
  -- truncated entry or a foreign number is not something this gateway can
  -- deliver to, and guessing would text a stranger.
  if v ~ '^9[0-9]{9}$' then
    return v;
  end if;

  return null;
end;
$$;

comment on function public.normalise_msisdn(text) is
  'A Nepali mobile number as the gateways want it: bare ten digits, or null.';

-- Money renders at the boundary everywhere else in this codebase. An SMS has
-- no render boundary in TypeScript, so it gets one here.
create or replace function public.format_paisa(p_paisa bigint, p_currency text default 'NPR')
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_currency = 'NPR' then 'Rs ' else p_currency || ' ' end
    || case
         when p_paisa % 100 = 0 then to_char(p_paisa / 100, 'FM999,999,999,990')
         else to_char(p_paisa / 100.0, 'FM999,999,999,990.00')
       end;
$$;

create or replace function public.render_notification_template(
  p_body text,
  p_vars jsonb
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out text := coalesce(p_body, '');
  v_key text;
  v_val text;
begin
  if p_vars is not null and jsonb_typeof(p_vars) = 'object' then
    for v_key, v_val in select key, value from jsonb_each_text(p_vars) loop
      v_out := replace(v_out, '{{' || v_key || '}}', coalesce(v_val, ''));
    end loop;
  end if;

  -- A placeholder nobody supplied is dropped rather than sent. "Your {{plan_name}}
  -- expires" reaching a member is worse than "Your  expires" never being written,
  -- and the gate asserts the built-in templates never leave one behind.
  v_out := regexp_replace(v_out, '\{\{[a-z_]+\}\}', '', 'g');
  v_out := btrim(regexp_replace(v_out, '[ ]{2,}', ' ', 'g'));

  return left(v_out, 1000);
end;
$$;

-- The built-in wording. An org that has edited nothing still sends something
-- sensible, so there is no per-org seeding step and a new org is never silently
-- unable to remind anyone.
--
-- The Nepali bodies are here because the PRD leaves the UI-language question
-- open and a gym may want Nepali messages regardless of the console language.
-- Note the cost: a Devanagari SMS is UCS-2, so it is 70 characters per segment
-- rather than 160, and bills roughly two to three times an English one. That is
-- documented in docs/notifications.md rather than hidden here.
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
     'यो {{gym_name}} बाट पठाइएको परीक्षण सन्देश हो। यो प्राप्त भयो भने ग्याटवे ठीक छ।')
  ) as t(event, locale, subject, body)
  where t.event = p_event::text
    and t.locale = case when p_locale in ('en', 'ne') then p_locale else 'en' end
  limit 1;
$$;

create or replace function public.resolve_notification_template(
  p_org_id uuid,
  p_event public.notification_event,
  p_channel public.notification_channel,
  p_locale text default 'en'
)
returns table (template_id uuid, subject text, body text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.subject, t.body
  from public.notification_templates t
  where t.org_id = p_org_id
    and t.event = p_event
    and t.channel = p_channel
    and t.locale = coalesce(p_locale, 'en')
    and t.is_active
  union all
  select null::uuid, d.subject, d.body
  from public.notification_default_template(p_event, p_channel, coalesce(p_locale, 'en')) d
  where not exists (
    select 1 from public.notification_templates t2
    where t2.org_id = p_org_id
      and t2.event = p_event
      and t2.channel = p_channel
      and t2.locale = coalesce(p_locale, 'en')
      and t2.is_active
  )
  limit 1;
$$;

revoke execute on function public.normalise_msisdn(text) from public, anon;
grant execute on function public.normalise_msisdn(text) to authenticated;

revoke execute on function public.format_paisa(bigint, text) from public, anon;
grant execute on function public.format_paisa(bigint, text) to authenticated;

revoke execute on function public.render_notification_template(text, jsonb) from public, anon;
grant execute on function public.render_notification_template(text, jsonb) to authenticated;

revoke execute on function public.notification_default_template(public.notification_event, public.notification_channel, text) from public, anon;
grant execute on function public.notification_default_template(public.notification_event, public.notification_channel, text) to authenticated;

revoke execute on function public.resolve_notification_template(uuid, public.notification_event, public.notification_channel, text) from public, anon;
grant execute on function public.resolve_notification_template(uuid, public.notification_event, public.notification_channel, text) to authenticated;
