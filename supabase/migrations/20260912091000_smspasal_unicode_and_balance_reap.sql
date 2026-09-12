-- SMSPasal: Devanagari messages, and a stricter balance reap.
--
-- Two corrections to the adapter added earlier today.
--
-- 1. `type=text` is the GSM alphabet only. A template in the `ne` locale -- and
--    the built-in Nepali templates are shipped with the product -- has to go
--    out as `type=unicode`, or the handset shows boxes. The type is therefore
--    derived from the message itself rather than fixed: anything outside ASCII
--    is unicode. The unicode endpoint documents `routeid` but not `campaign`,
--    so the campaign id is sent only on a text message.
--
-- 2. `read_notification_gateway_balance` decided "no answer yet" by testing the
--    record for null, which is also true of a row whose columns happen to all
--    be null. It now tests FOUND, and a response carrying no status code at all
--    is reported as an error rather than falling through to the body check.

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

      v_params := jsonb_build_object(
        'key',      coalesce(p_secret, ''),
        'type',     case when v_unicode then 'unicode' else 'text' end,
        'contacts', coalesce(p_to, ''),
        'senderid', coalesce(p_sender, ''),
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

create or replace function public.read_notification_gateway_balance(p_provider_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_resp record;
  v_found boolean;
  v_body text;
  v_parsed jsonb;
  v_error text;
begin
  select p.* into v_row
  from public.notification_providers p
  where p.id = p_provider_id;

  if v_row.id is null then
    raise exception 'That gateway does not exist'
      using errcode = 'no_data_found';
  end if;

  if not (public.is_org_member(v_row.org_id) and public.jwt_is_staff() and public.jwt_is_owner()) then
    raise exception 'Only an owner can read the gateway balance'
      using errcode = 'insufficient_privilege';
  end if;

  -- Already settled, or never asked: answer from the row.
  if v_row.balance_request_id is null then
    return jsonb_build_object(
      'pending', false,
      'routes', v_row.balance,
      'error', v_row.balance_error,
      'checked_at', v_row.balance_checked_at
    );
  end if;

  select distinct on (h.id) h.status_code, h.content, h.timed_out, h.error_msg
    into v_resp
  from net._http_response h
  where h.id = v_row.balance_request_id
  order by h.id, h.created desc;

  v_found := found;

  if not v_found then
    -- Nothing back yet. A request that never answers is not left pending
    -- forever: after a minute it is reported as a timeout and cleared, so the
    -- next press starts a fresh one.
    if v_row.balance_checked_at < now() - interval '1 minute' then
      update public.notification_providers
         set balance_request_id = null,
             balance_error = 'The gateway did not answer in time'
       where id = p_provider_id;
      return jsonb_build_object(
        'pending', false, 'routes', null,
        'error', 'The gateway did not answer in time',
        'checked_at', v_row.balance_checked_at
      );
    end if;

    return jsonb_build_object(
      'pending', true, 'routes', null, 'error', null,
      'checked_at', v_row.balance_checked_at
    );
  end if;

  v_body := btrim(coalesce(v_resp.content, ''));
  v_parsed := public.try_jsonb(v_body);

  if coalesce(v_resp.timed_out, false) or v_resp.error_msg is not null then
    v_error := coalesce(v_resp.error_msg, 'The gateway did not answer in time');
  elsif v_resp.status_code is null then
    v_error := 'The gateway answered with no status at all';
  elsif v_resp.status_code not between 200 and 299 then
    v_error := 'The gateway answered http ' || v_resp.status_code;
  elsif v_parsed is null or jsonb_typeof(v_parsed) <> 'array' then
    -- `ERR: INVALID API KEY` and friends arrive as plain text.
    v_error := coalesce(nullif(left(v_body, 200), ''), 'The gateway sent no balance');
  end if;

  update public.notification_providers
     set balance_request_id = null,
         balance = case when v_error is null then v_parsed else null end,
         balance_error = v_error,
         balance_checked_at = now()
   where id = p_provider_id;

  return jsonb_build_object(
    'pending', false,
    'routes', case when v_error is null then v_parsed else null end,
    'error', v_error,
    'checked_at', now()
  );
end;
$$;

revoke execute on function public.notification_request(public.notification_provider, jsonb, text, text, text, text, text, text) from public, anon;
grant execute on function public.notification_request(public.notification_provider, jsonb, text, text, text, text, text, text) to authenticated;

revoke execute on function public.read_notification_gateway_balance(uuid) from public, anon;
grant execute on function public.read_notification_gateway_balance(uuid) to authenticated;
