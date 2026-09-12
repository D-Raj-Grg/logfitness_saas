-- One sender ID per carrier.
--
-- A Nepali SMS gateway registers a sender ID with each operator separately, and
-- a reseller often ends up with different words on each: the gym's SMSPasal
-- account sends as `TN_ALERT` on Ncell and as `smsbit` on NTC. The gateway API
-- takes exactly one `senderid` per request, so the right one has to be chosen
-- from the recipient's own number.
--
-- Only two operators are left to choose between. Smart Telecom lost its licence
-- in April 2023 and UTL and Hello Mobile are gone as well, so 961/962/988,
-- 972 and 963 are dead ranges rather than a third case.
--
-- Both per-carrier senders are optional. Blank means "use the gateway's own
-- sender ID", which is the right default here: an account usually holds one
-- registered sender and the reseller's route substitutes the operator-specific
-- one on its side.

create or replace function public.nepal_mobile_carrier(p_to text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Digits only, then the last ten of them: the same number arrives as
  -- 9841234567, 977-984-1234567 and +9779841234567.
  with n as (
    select right(regexp_replace(coalesce(p_to, ''), '[^0-9]', '', 'g'), 10) as digits
  )
  select case
    when length(digits) < 10 then null
    when left(digits, 3) in ('984', '985', '986', '974', '975', '976') then 'ntc'
    when left(digits, 3) in ('980', '981', '982', '970') then 'ncell'
    else null
  end
  from n;
$$;

comment on function public.nepal_mobile_carrier(text) is
  'NTC or Ncell from a Nepali mobile number, or null when the prefix belongs to neither (including the revoked Smart, UTL and Hello ranges).';

create or replace function public.notification_request(
  p_provider public.notification_provider,
  p_config jsonb,
  p_endpoint text,
  p_secret text,
  p_sender text,
  p_to text,
  p_subject text,
  p_body text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_cfg jsonb := coalesce(p_config, '{}'::jsonb);
  v_params jsonb;
  v_unicode boolean;
  v_sender text;
  v_vars jsonb := jsonb_build_object(
    'to', coalesce(p_to, ''),
    'text', coalesce(p_body, ''),
    'subject', coalesce(p_subject, ''),
    'sender', coalesce(p_sender, ''),
    'token', coalesce(p_secret, '')
  );
begin
  case p_provider
    when 'log_only' then
      -- No request at all. This is what an org with no gateway falls back to
      -- in the gate, so the whole pipeline can be exercised offline.
      return jsonb_build_object('method', 'none');

    when 'sparrow_sms' then
      return jsonb_build_object(
        'method', 'GET',
        'url', coalesce(p_endpoint, 'https://api.sparrowsms.com/v2/sms/'),
        'params', jsonb_build_object(
          'token', coalesce(p_secret, ''),
          'from',  coalesce(p_sender, ''),
          'to',    coalesce(p_to, ''),
          'text',  coalesce(p_body, '')
        ),
        'headers', '{}'::jsonb
      );

    when 'aakash_sms' then
      -- No `from`: Aakash fixes the sender identity on the account.
      return jsonb_build_object(
        'method', 'GET',
        'url', coalesce(p_endpoint, 'https://sms.aakashsms.com/sms/v3/send'),
        'params', jsonb_build_object(
          'auth_token', coalesce(p_secret, ''),
          'to',         coalesce(p_to, ''),
          'text',       coalesce(p_body, '')
        ),
        'headers', '{}'::jsonb
      );

    when 'smspasal_sms' then
      -- The GSM alphabet is ASCII-ish; a Nepali template is not, and `text`
      -- would arrive as boxes. pg_net percent-encodes the params either way.
      v_unicode := coalesce(p_body, '') ~ '[^[:ascii:]]';

      -- The carrier's own sender ID when the gym has registered one, and the
      -- gateway's sender otherwise.
      v_sender := coalesce(
        nullif(btrim(coalesce(
          case public.nepal_mobile_carrier(p_to)
            when 'ntc'   then v_cfg ->> 'sender_ntc'
            when 'ncell' then v_cfg ->> 'sender_ncell'
            else null
          end, '')), ''),
        p_sender,
        ''
      );

      v_params := jsonb_build_object(
        'key',      coalesce(p_secret, ''),
        'type',     case when v_unicode then 'unicode' else 'text' end,
        'contacts', coalesce(p_to, ''),
        'senderid', v_sender,
        'msg',      coalesce(p_body, '')
      );

      -- Absent rather than blank: `campaign=` with no value is not the same
      -- request as no `campaign` at all, and only the latter falls back to the
      -- account default. The unicode endpoint documents no campaign at all.
      if not v_unicode
         and nullif(btrim(coalesce(v_cfg ->> 'campaign', '')), '') is not null then
        v_params := v_params || jsonb_build_object('campaign', btrim(v_cfg ->> 'campaign'));
      end if;

      if nullif(btrim(coalesce(v_cfg ->> 'routeid', '')), '') is not null then
        v_params := v_params || jsonb_build_object('routeid', btrim(v_cfg ->> 'routeid'));
      end if;

      return jsonb_build_object(
        'method', 'GET',
        'url', coalesce(p_endpoint, 'https://sms.smspasal.com/smsapi/index.php'),
        'params', v_params,
        'headers', '{}'::jsonb
      );

    when 'viber_business' then
      return jsonb_build_object(
        'method', 'POST',
        'url', coalesce(p_endpoint, 'https://chatapi.viber.com/pa/send_message'),
        'headers', jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Viber-Auth-Token', coalesce(p_secret, '')
        ),
        'body', jsonb_build_object(
          'receiver', coalesce(p_to, ''),
          'min_api_version', 1,
          'sender', jsonb_build_object('name', coalesce(p_sender, 'Gym')),
          'type', 'text',
          'text', coalesce(p_body, '')
        )
      );

    when 'resend_email' then
      return jsonb_build_object(
        'method', 'POST',
        'url', coalesce(p_endpoint, 'https://api.resend.com/emails'),
        'headers', jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(p_secret, '')
        ),
        'body', jsonb_build_object(
          'from', coalesce(p_sender, 'noreply@lordofgyms.com'),
          'to', jsonb_build_array(coalesce(p_to, '')),
          'subject', coalesce(nullif(p_subject, ''), 'Message from your gym'),
          'text', coalesce(p_body, '')
        )
      );

    when 'custom_http' then
      if upper(coalesce(v_cfg ->> 'method', 'GET')) = 'POST' then
        return jsonb_build_object(
          'method', 'POST',
          'url', p_endpoint,
          'headers', public.notification_interpolate(v_cfg -> 'headers', v_vars)
                     || jsonb_build_object('Content-Type', 'application/json'),
          'body', public.notification_interpolate(v_cfg -> 'body', v_vars)
        );
      else
        return jsonb_build_object(
          'method', 'GET',
          'url', p_endpoint,
          'params', public.notification_interpolate(v_cfg -> 'params', v_vars),
          'headers', public.notification_interpolate(v_cfg -> 'headers', v_vars)
        );
      end if;

    else
      raise exception 'Unknown notification provider %', p_provider
        using errcode = 'check_violation';
  end case;
end;
$$;

revoke execute on function public.nepal_mobile_carrier(text) from public, anon;
grant execute on function public.nepal_mobile_carrier(text) to authenticated;

revoke execute on function public.notification_request(public.notification_provider, jsonb, text, text, text, text, text, text) from public, anon;
grant execute on function public.notification_request(public.notification_provider, jsonb, text, text, text, text, text, text) to authenticated;
