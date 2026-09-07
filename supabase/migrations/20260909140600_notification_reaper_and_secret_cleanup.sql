-- Two defects the end-to-end probe turned up, before any of this shipped.
--
-- 1. The reaper wrote `next_attempt_at` on every row it touched, including the
--    ones it had just marked `sent`. Harmless today -- the worker only claims
--    `queued` rows -- but it means a delivered message carries a retry time,
--    which is a lie the next person to read the table would have to work out.
--
-- 2. Deleting a gateway left its token in Vault forever. `notification_providers`
--    rows cascade away with the org, and `clear_notification_credential` only
--    runs when an owner explicitly clears a token, so the secret outlived
--    everything that referenced it and nothing could ever name it again. The
--    teardown of the probe had to delete those secrets by hand, which is how
--    this was found.

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
  ),
  scored as (
    select v.*, ((v.v ->> 'ok')::boolean and v.transport_error is null) as delivered
    from verdict v
  )
  update public.notification_messages m
     set status = case
                    when s.delivered then 'sent'::public.notification_status
                    when s.attempts >= 4 then 'failed'::public.notification_status
                    else 'queued'::public.notification_status
                  end,
         provider_status = s.status_code,
         provider_message_id = s.v ->> 'message_id',
         last_error = case when s.delivered then null
                           else left(coalesce(s.transport_error, s.v ->> 'error'), 500) end,
         sent_at = case when s.delivered then now() else m.sent_at end,
         -- 5, 25 then 125 minutes, and only for something that will be tried
         -- again. A gateway out of credits will not have credits in sixty
         -- seconds, and a delivered message has no next attempt.
         next_attempt_at = case
                             when s.delivered or s.attempts >= 4 then m.next_attempt_at
                             else now() + make_interval(mins => power(5, least(s.attempts, 3))::integer)
                           end
    from scored s
   where m.id = s.id;

  get diagnostics v_n = row_count;

  -- net.http_request_queue and net._http_response are UNLOGGED tables: a crash,
  -- a compute resize or a Postgres upgrade truncates both. A row can therefore
  -- be left `sending` with a request_id whose response -- or whose request --
  -- no longer exists. Retrying is the only recovery, which makes this pipeline
  -- at-least-once: a member may, rarely, receive the same message twice.
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

revoke execute on function public.reap_notification_responses(integer) from public, anon, authenticated;

-- A gateway's token goes when the gateway does, whether that is an owner
-- deleting the row or the whole org cascading away.
create or replace function public.drop_notification_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where name = public.notification_secret_name(old.id);
  return old;
end;
$$;

create trigger notification_providers_drop_secret
  after delete on public.notification_providers
  for each row execute function public.drop_notification_secret();
