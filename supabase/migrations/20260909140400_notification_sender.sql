-- Phase 5, part 5 of 6: the gateway abstraction and the worker.
--
-- Sending lives in Postgres, not in an Edge Function. A function needs project
-- secrets, and project secrets can only be set from the Supabase dashboard or a
-- logged-in CLI -- neither of which this project's tooling has. That is exactly
-- why `qr-token` sat answering 503 until its key moved into Vault, and why
-- `push-fanout`'s FCM path is recorded in TASKS.md as never having been
-- exercised. pg_net plus pg_cron needs nothing provisioned by hand, so this
-- path can be proven end to end -- and was, against a live HTTPS endpoint,
-- before it was committed.
--
-- The abstraction the PRD's risk table asks for ("provider abstraction behind a
-- single interface") is two PURE functions:
--
--   notification_request(...)      -> {method, url, params, headers, body}
--   notification_response_ok(...)  -> {ok, message_id, error}
--
-- No network, no writes, so the SQL gate asserts both directly against real
-- provider payloads. Adding a gateway is one enum value and two `case` arms.
--
-- Note what net.http_post cannot do: pg_net 0.20 raises unless the Content-Type
-- header is exactly `application/json`, so form-encoded POST is unavailable.
-- Sparrow and Aakash both document GET as equivalent to POST, so those two go
-- out as net.http_get with `params`, which pg_net urlencodes itself. The cost is
-- that the token sits in net.http_request_queue.url for up to the pg_net TTL
-- (six hours on this project).

create extension if not exists pg_net with schema extensions;

-- pg_net's install script grants schema, table, sequence and function access to
-- PUBLIC, which is an outbound HTTP primitive aimed at anything the database
-- can reach. Revoking EXECUTE on the functions alone would not be enough --
-- PUBLIC also holds write access to the queue table, so
-- `insert into net.http_request_queue ...; select net.wake();` would still work.
--
-- KNOWN LIMITATION, verified on this project: schema `net` and every object in
-- it is owned by `supabase_admin`, and `postgres` (which is what a migration
-- and the dashboard SQL editor both run as) is not the owner and holds no grant
-- option. These REVOKEs therefore succeed as no-ops and the PUBLIC grants
-- remain. They are kept because they are correct wherever ownership allows
-- them, and because deleting them would hide the problem. What actually keeps
-- this closed today is that `net` is not one of PostgREST's exposed schemas, so
-- no API caller can reach these functions. See TASKS.md.
revoke all     on schema net                  from public;
revoke all     on all tables    in schema net from public, anon, authenticated;
revoke all     on all sequences in schema net from public, anon, authenticated;
revoke execute on all functions in schema net from public, anon, authenticated;

grant usage   on schema net                  to postgres;
grant all     on all tables    in schema net to postgres;
grant all     on all sequences in schema net to postgres;
grant execute on all functions in schema net to postgres;

-- ---------------------------------------------------------------------------
-- small helpers
-- ---------------------------------------------------------------------------

-- A gateway may answer with HTML, an empty body, or a 502 page from a proxy.
-- Parsing that must not abort a batch.
create or replace function public.try_jsonb(p_text text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_text is null or length(btrim(p_text)) = 0 then
    return null;
  end if;
  return p_text::jsonb;
exception when others then
  return null;
end;
$$;

-- Substitute {{to}}, {{text}} and friends through every string value of a
-- custom gateway's params/headers/body template.
create or replace function public.notification_interpolate(p_obj jsonb, p_vars jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(
      key,
      case when jsonb_typeof(value) = 'string'
           then to_jsonb(public.render_notification_template(value #>> '{}', p_vars))
           else value end
    ),
    '{}'::jsonb)
  from jsonb_each(coalesce(p_obj, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- the single interface: build a request
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
-- the single interface: read a response
-- ---------------------------------------------------------------------------
--
-- pg_net reports a 500 as an ordinary row, not an error, so "did it work" is
-- always `status_code between 200 and 299` AND whatever the provider says in
-- the body. Sparrow in particular answers HTTP 200 for a queued message and
-- HTTP 403 with a numeric code for a rejected one, and both are JSON.
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
-- the worker
-- ---------------------------------------------------------------------------

create or replace function public.send_notification_batch(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_provider record;
  v_secret text;
  v_req jsonb;
  v_request_id bigint;
  v_sent integer := 0;
begin
  for r in
    with claimed as (
      select id from public.notification_messages
      where status = 'queued'::public.notification_status
        and next_attempt_at <= now()
      order by next_attempt_at, id
      limit greatest(coalesce(p_limit, 50), 1)
      for update skip locked
    )
    update public.notification_messages m
       set status = 'sending'::public.notification_status,
           attempts = m.attempts + 1,
           sent_at = now()
      from claimed c
     where m.id = c.id
    returning m.id, m.org_id, m.channel, m.to_address, m.subject, m.body
  loop
    -- One bad row must not roll the batch back: a rollback would also cancel
    -- every net.wake() at-commit callback and silently un-send the rest.
    begin
      select np.* into v_provider
      from public.notification_providers np
      where np.org_id = r.org_id and np.channel = r.channel and np.is_active
      limit 1;

      if v_provider.id is null then
        update public.notification_messages
           set status = 'skipped', last_error = 'No gateway configured for ' || r.channel::text
         where id = r.id;
        continue;
      end if;

      v_secret := public.notification_credential(v_provider.id);

      if v_provider.provider <> 'log_only'::public.notification_provider
         and (v_secret is null or length(btrim(v_secret)) = 0) then
        update public.notification_messages
           set status = 'skipped',
               provider = v_provider.provider,
               last_error = 'No gateway token has been set for ' || r.channel::text
         where id = r.id;
        continue;
      end if;

      v_req := public.notification_request(
        v_provider.provider, v_provider.config, v_provider.endpoint_url,
        v_secret, v_provider.sender_id, r.to_address, r.subject, r.body
      );

      if v_req ->> 'method' = 'none' then
        update public.notification_messages
           set status = 'sent', provider = v_provider.provider,
               provider_message_id = 'log-only', provider_status = 200,
               sent_at = now(), last_error = null
         where id = r.id;
        v_sent := v_sent + 1;
        continue;
      elsif v_req ->> 'method' = 'GET' then
        v_request_id := net.http_get(
          url := v_req ->> 'url',
          params := coalesce(v_req -> 'params', '{}'::jsonb),
          headers := coalesce(v_req -> 'headers', '{}'::jsonb),
          timeout_milliseconds := 15000
        );
      else
        v_request_id := net.http_post(
          url := v_req ->> 'url',
          body := coalesce(v_req -> 'body', '{}'::jsonb),
          params := '{}'::jsonb,
          headers := coalesce(v_req -> 'headers', '{"Content-Type": "application/json"}'::jsonb),
          timeout_milliseconds := 15000
        );
      end if;

      -- Committed atomically with the queued request: pg_net only fires its
      -- wake callback at COMMIT, so there can never be a request in flight
      -- whose id this row does not hold.
      update public.notification_messages
         set request_id = v_request_id, provider = v_provider.provider
       where id = r.id;

      v_sent := v_sent + 1;
    exception when others then
      -- sqlerrm only. A url or header built from the token must never reach a
      -- log line or cron.job_run_details.
      update public.notification_messages
         set status = 'failed', last_error = left(sqlerrm, 500)
       where id = r.id;
    end;
  end loop;

  return v_sent;
end;
$$;

create or replace function public.reap_notification_responses(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  with claimed as (
    select id, request_id, provider, attempts
    from public.notification_messages
    where status = 'sending'::public.notification_status
      and request_id is not null
    order by sent_at
    limit greatest(coalesce(p_limit, 200), 1)
    for update skip locked
  ),
  resp as (
    -- net._http_response has no unique index on id, so pick one row per id.
    select distinct on (h.id) h.id, h.status_code, h.content, h.timed_out, h.error_msg
    from net._http_response h
    where h.id in (select request_id from claimed)
    order by h.id, h.created desc
  ),
  verdict as (
    select c.id,
           c.attempts,
           p.status_code,
           p.content,
           coalesce(p.error_msg,
                    case when p.timed_out then 'The gateway did not answer in time' end) as transport_error,
           public.notification_response_ok(c.provider, coalesce(p.status_code, 0), p.content) as v
    from claimed c
    join resp p on p.id = c.request_id
  )
  update public.notification_messages m
     set status = case
                    when (v.v ->> 'ok')::boolean and v.transport_error is null
                      then 'sent'::public.notification_status
                    when v.attempts >= 4 then 'failed'::public.notification_status
                    else 'queued'::public.notification_status
                  end,
         provider_status = v.status_code,
         provider_message_id = v.v ->> 'message_id',
         last_error = case when (v.v ->> 'ok')::boolean and v.transport_error is null
                           then null
                           else left(coalesce(v.transport_error, v.v ->> 'error'), 500) end,
         sent_at = case when (v.v ->> 'ok')::boolean and v.transport_error is null
                        then now() else m.sent_at end,
         next_attempt_at = now() + make_interval(mins => power(5, least(v.attempts, 3))::integer)
    from verdict v
   where m.id = v.id;

  get diagnostics v_n = row_count;

  update public.notification_messages m
     set status = case when m.attempts >= 4 then 'failed'::public.notification_status
                       else 'queued'::public.notification_status end,
         next_attempt_at = now() + interval '5 minutes',
         last_error = 'No gateway response arrived; the request may have been lost'
   where m.status = 'sending'::public.notification_status
     and m.sent_at < now() - interval '10 minutes'
     and not exists (select 1 from net._http_response h where h.id = m.request_id);

  return v_n;
end;
$$;

revoke execute on function public.send_notification_batch(integer) from public, anon, authenticated;
revoke execute on function public.reap_notification_responses(integer) from public, anon, authenticated;

revoke execute on function public.try_jsonb(text) from public, anon;
grant execute on function public.try_jsonb(text) to authenticated;

revoke execute on function public.notification_interpolate(jsonb, jsonb) from public, anon;
grant execute on function public.notification_interpolate(jsonb, jsonb) to authenticated;

-- Pure and secret-free by construction: the caller passes the token in, so
-- letting the console call these to preview a request leaks nothing it does not
-- already hold.
revoke execute on function public.notification_request(public.notification_provider, jsonb, text, text, text, text, text, text) from public, anon;
grant execute on function public.notification_request(public.notification_provider, jsonb, text, text, text, text, text, text) to authenticated;

revoke execute on function public.notification_response_ok(public.notification_provider, integer, text) from public, anon;
grant execute on function public.notification_response_ok(public.notification_provider, integer, text) to authenticated;
