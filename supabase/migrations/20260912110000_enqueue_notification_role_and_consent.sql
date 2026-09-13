-- Applied to the live project through the Supabase MCP as
-- `20260912090124_enqueue_notification_role_and_consent`; mirrored here by hand
-- so git carries the same history (PLANNING.md, and TASKS.md's note that the
-- CLI is not logged in on this machine).
--
-- `enqueue_notification` is the single INSERT into the outbox, and until now it
-- was the widest door in the notification surface.
--
-- It is SECURITY DEFINER and granted to `authenticated`, and its only role test
-- was `jwt_is_staff()`. Every other guard in the body is conditional on an
-- argument being non-null -- `has_branch_access` only when `p_branch_id` is
-- given, the member check only when `p_member_id` is -- and every one of those
-- arguments defaults to null. So the four required arguments alone reached the
-- gateway with no check at all:
--
--   * a trainer could send, though `member_message_target` refuses one by name;
--   * `members.notifications_opt_out` was never consulted, because that check
--     lives only in `send_member_notification` -- so the opt-out that
--     `docs/notifications.md` calls "not overridable" was overridable by
--     calling one function lower down;
--   * with no `p_branch_id` the row landed `branch_id is null`, which the read
--     policy treats as org-wide.
--
-- Neither gap was reachable through either client -- the console and the
-- Flutter app both call this from one owner-only Send test -- but PostgREST
-- exposes the function to any staff JWT regardless of what a client chooses to
-- call, so the client's restraint was never the control.
--
-- Two checks are added, both transcribed from the wrapper that already had
-- them rather than invented here. Nothing that worked before stops working:
-- the nightly sweeps insert into `notification_messages` directly and never
-- call this function (verified against the live catalogue), and the only two
-- callers -- `send_member_notification` and `send_visitor_notification` -- are
-- SECURITY DEFINER, which does not change whose JWT the `jwt_*` helpers read,
-- so a front desk calling them still passes.

create or replace function public.enqueue_notification(
  p_channel    public.notification_channel,
  p_event      public.notification_event,
  p_to         text,
  p_body       text,
  p_subject    text default null,
  p_member_id  uuid default null,
  p_staff_id   uuid default null,
  p_branch_id  uuid default null,
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

  -- `{owner, manager, front_desk}`, the same set `member_message_target`
  -- enforces and the same helper the rest of the schema states it with. A
  -- trainer is refused here as well as there, so the refusal no longer depends
  -- on which function the caller happened to pick.
  if not public.jwt_can_serve_members() then
    raise exception 'Your role cannot send messages'
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

  -- Consent, checked at the outbox rather than only at the wrapper. A member
  -- who asked not to be texted is refused with a sentence, not skipped
  -- quietly, and not by a caller's good manners.
  if p_member_id is not null and exists (
    select 1 from public.members m
    where m.id = p_member_id and m.notifications_opt_out
  ) then
    raise exception 'That member has asked not to receive messages'
      using errcode = 'check_violation';
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
