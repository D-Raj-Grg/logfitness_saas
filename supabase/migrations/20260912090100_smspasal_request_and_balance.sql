-- SMSPasal, part 2 of 2: the request, the response, and the credit balance.
--
-- SMSPasal (sms.smspasal.com, a ThemeNepal reseller) is a single GET with the
-- API key as an ordinary query parameter, and it answers in plain text rather
-- than JSON: `SMS-SHOOT-ID/<id>` for an accepted message and `ERR: <reason>`
-- for a refused one. `notification_response_ok` therefore reads the body as
-- text for this provider instead of going through `try_jsonb`.
--
-- `campaign` and `routeid` are account-specific ids. Both are optional: omitted
-- entirely when the gym has not set them, which makes the gateway fall back to
-- the defaults on the account. They live in `notification_providers.config`
-- rather than in new columns because no other provider has them.
--
-- The credit balance is a second endpoint, and reading it has to happen inside
-- the database for the same reason sending does: the API key lives in Vault and
-- no client role can read it. So it is a two-step, like every other pg_net
-- call here -- `request_notification_gateway_balance` fires the request and
-- `read_notification_gateway_balance` reaps the answer -- with the result
-- parked on the provider row. None of the four new columns can hold the key.

-- ---------------------------------------------------------------------------
-- request
-- ---------------------------------------------------------------------------

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
      -- pg_net percent-encodes params, so `msg` goes in as the raw text.
      v_params := jsonb_build_object(
        'key',      coalesce(p_secret, ''),
        'type',     'text',
        'contacts', coalesce(p_to, ''),
        'senderid', coalesce(p_sender, ''),
        'msg',      coalesce(p_body, '')
      );

      -- Absent rather than blank: `campaign=` with no value is not the same
      -- request as no `campaign` at all, and only the latter falls back to the
      -- account default.
      if nullif(btrim(coalesce(v_cfg ->> 'campaign', '')), '') is not null then
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

-- ---------------------------------------------------------------------------
-- response
-- ---------------------------------------------------------------------------

create or replace function public.notification_response_ok(
  p_provider public.notification_provider,
  p_status integer,
  p_body text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  j jsonb := public.try_jsonb(p_body);
  http_ok boolean := p_status between 200 and 299;
  t text := btrim(coalesce(p_body, ''));
begin
  case p_provider
    when 'log_only' then
      return jsonb_build_object('ok', true, 'message_id', 'log-only', 'error', null);

    when 'sparrow_sms' then
      if http_ok and coalesce(j ->> 'response_code', '') = '200' then
        return jsonb_build_object('ok', true, 'message_id', j ->> 'count', 'error', null);
      end if;
      return jsonb_build_object(
        'ok', false, 'message_id', null,
        'error', coalesce(
          nullif(btrim(coalesce(j ->> 'response', '')), ''),
          case coalesce(j ->> 'response_code', '')
            when '1000' then 'Sparrow: a required field was missing'
            when '1001' then 'Sparrow: this server IP is not whitelisted'
            when '1002' then 'Sparrow: the gateway token is not valid'
            when '1010' then 'Sparrow: the message text was empty'
            when '1012' then 'Sparrow: no credits available'
            when '1013' then 'Sparrow: not enough credits for this message'
            else 'Sparrow refused the message (http ' || p_status || ')'
          end)
      );

    when 'aakash_sms' then
      if http_ok and coalesce(j ->> 'error', 'true') = 'false' then
        return jsonb_build_object('ok', true, 'message_id', j #>> '{data,0,id}', 'error', null);
      end if;
      return jsonb_build_object(
        'ok', false, 'message_id', null,
        'error', coalesce(nullif(btrim(coalesce(j ->> 'message', '')), ''),
                          'Aakash refused the message (http ' || p_status || ')')
      );

    when 'smspasal_sms' then
      -- Plain text, not JSON. `SMS-SHOOT-ID/<alnum>` is the only success shape;
      -- everything else, including a 200 carrying `ERR: ...`, is a refusal.
      if http_ok and t like 'SMS-SHOOT-ID/%' then
        return jsonb_build_object(
          'ok', true,
          'message_id', nullif(btrim(split_part(t, '/', 2)), ''),
          'error', null
        );
      end if;
      return jsonb_build_object(
        'ok', false, 'message_id', null,
        -- The gateway's own wording is already a sentence ("ERR: INVALID API
        -- KEY"), so it is shown as it arrived rather than translated.
        'error', coalesce(nullif(left(t, 200), ''),
                          'SMSPasal refused the message (http ' || p_status || ')')
      );

    when 'viber_business' then
      if http_ok and coalesce(j ->> 'status', '-1') = '0' then
        return jsonb_build_object('ok', true, 'message_id', j ->> 'message_token', 'error', null);
      end if;
      return jsonb_build_object(
        'ok', false, 'message_id', null,
        'error', coalesce(nullif(btrim(coalesce(j ->> 'status_message', '')), ''),
                          'Viber refused the message (http ' || p_status || ')')
      );

    when 'resend_email' then
      if http_ok and (j ->> 'id') is not null then
        return jsonb_build_object('ok', true, 'message_id', j ->> 'id', 'error', null);
      end if;
      return jsonb_build_object(
        'ok', false, 'message_id', null,
        'error', coalesce(nullif(btrim(coalesce(j ->> 'message', '')), ''),
                          'The email gateway refused the message (http ' || p_status || ')')
      );

    else
      -- custom_http and anything added later: HTTP status is all we can know.
      if http_ok then
        return jsonb_build_object('ok', true, 'message_id', j ->> 'id', 'error', null);
      end if;
      return jsonb_build_object('ok', false, 'message_id', null,
        'error', 'The gateway answered http ' || p_status);
  end case;
end;
$$;

-- ---------------------------------------------------------------------------
-- credit balance
-- ---------------------------------------------------------------------------

alter table public.notification_providers
  add column if not exists balance_request_id bigint,
  add column if not exists balance_checked_at timestamptz,
  add column if not exists balance jsonb,
  add column if not exists balance_error text;

comment on column public.notification_providers.balance is
  'Last credit balance the gateway reported, as it reported it. Never a secret.';

-- Which providers can answer "how many credits are left". A gateway absent from
-- here makes the RPC raise rather than silently return nothing, so the console
-- can hide the button on exactly the same rule.
create or replace function public.notification_balance_url(
  p_provider public.notification_provider,
  p_secret text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_provider
    when 'smspasal_sms' then
      'https://sms.smspasal.com/miscapi/' || coalesce(p_secret, '') || '/getBalance/true/'
    else null
  end;
$$;

create or replace function public.request_notification_gateway_balance(p_provider_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_secret text;
  v_url text;
  v_request_id bigint;
begin
  select p.* into v_row
  from public.notification_providers p
  where p.id = p_provider_id;

  if v_row.id is null then
    raise exception 'That gateway does not exist'
      using errcode = 'no_data_found';
  end if;

  -- Definer, so the RLS policy is not what protects this. Checked by hand, the
  -- same way the credential RPCs do it.
  if not (public.is_org_member(v_row.org_id) and public.jwt_is_staff() and public.jwt_is_owner()) then
    raise exception 'Only an owner can check the gateway balance'
      using errcode = 'insufficient_privilege';
  end if;

  v_secret := public.notification_credential(p_provider_id);

  if v_secret is null or length(btrim(v_secret)) = 0 then
    update public.notification_providers
       set balance_request_id = null,
           balance_checked_at = now(),
           balance = null,
           balance_error = 'No gateway token has been set yet'
     where id = p_provider_id;
    return;
  end if;

  v_url := public.notification_balance_url(v_row.provider, v_secret);

  if v_url is null then
    raise exception 'This gateway does not publish a credit balance'
      using errcode = 'check_violation';
  end if;

  -- A button a browser can hold down is a button that can be held down. One
  -- request per gateway per 20 seconds; an in-flight one is simply reused.
  if v_row.balance_request_id is not null
     and v_row.balance_checked_at is not null
     and v_row.balance_checked_at > now() - interval '20 seconds' then
    return;
  end if;

  v_request_id := net.http_get(
    url := v_url,
    params := '{}'::jsonb,
    headers := '{}'::jsonb,
    timeout_milliseconds := 15000
  );

  update public.notification_providers
     set balance_request_id = v_request_id,
         balance_checked_at = now(),
         balance = null,
         balance_error = null
   where id = p_provider_id;
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

  if v_resp is null then
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

  if v_resp.timed_out or v_resp.error_msg is not null then
    v_error := coalesce(v_resp.error_msg, 'The gateway did not answer in time');
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

-- Pure and secret-free by construction: the caller passes the token in.
revoke execute on function public.notification_request(public.notification_provider, jsonb, text, text, text, text, text, text) from public, anon;
grant execute on function public.notification_request(public.notification_provider, jsonb, text, text, text, text, text, text) to authenticated;

revoke execute on function public.notification_response_ok(public.notification_provider, integer, text) from public, anon;
grant execute on function public.notification_response_ok(public.notification_provider, integer, text) to authenticated;

-- Builds a URL with the token inside it, so no client role may call it.
revoke execute on function public.notification_balance_url(public.notification_provider, text) from public, anon, authenticated;

revoke execute on function public.request_notification_gateway_balance(uuid) from public, anon;
grant execute on function public.request_notification_gateway_balance(uuid) to authenticated;

revoke execute on function public.read_notification_gateway_balance(uuid) from public, anon;
grant execute on function public.read_notification_gateway_balance(uuid) to authenticated;
