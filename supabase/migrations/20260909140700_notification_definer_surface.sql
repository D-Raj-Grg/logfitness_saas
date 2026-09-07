-- Two holes get_advisors(security) found in the Phase 5 work, closed before it
-- shipped.
--
-- 1. `resolve_notification_template` was SECURITY DEFINER and took an org id as
--    a parameter, so a signed-in caller from any gym could ask for another
--    gym's message wording through /rest/v1/rpc and get it -- the function ran
--    as its owner and the RLS policy on notification_templates never applied.
--    Only marketing copy, but it is a cross-tenant read, and the gate missed it
--    because the gate tested the table's policies rather than an RPC that
--    stepped around them. It is SECURITY INVOKER now: the org's own row comes
--    back through RLS, and the org check is stated as well so a call for
--    somebody else's org returns nothing rather than quietly falling through to
--    the built-in wording.
--
-- 2. `drop_notification_secret` and `seed_notification_rules_for_new_org` are
--    trigger functions, and every function in `public` is executable by
--    PUBLIC unless told otherwise -- so both appeared on /rest/v1/rpc as
--    anon-callable SECURITY DEFINER functions. Postgres refuses to run a
--    trigger function called directly, so neither was exploitable, but this is
--    a new advisory category for this project (0028, "public can execute"),
--    not one of the standing 0029 exceptions, and a new category is exactly
--    the thing that should not be waved through.

create or replace function public.resolve_notification_template(
  p_org_id uuid,
  p_event public.notification_event,
  p_channel public.notification_channel,
  p_locale text default 'en'
)
returns table (template_id uuid, subject text, body text)
language sql
stable
security invoker
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
  where public.is_org_member(p_org_id)
    and not exists (
      select 1 from public.notification_templates t2
      where t2.org_id = p_org_id
        and t2.event = p_event
        and t2.channel = p_channel
        and t2.locale = coalesce(p_locale, 'en')
        and t2.is_active
    )
  limit 1;
$$;

revoke execute on function public.resolve_notification_template(uuid, public.notification_event, public.notification_channel, text) from public, anon;
grant execute on function public.resolve_notification_template(uuid, public.notification_event, public.notification_channel, text) to authenticated;

-- Trigger functions belong to their triggers, not to the API.
revoke execute on function public.drop_notification_secret() from public, anon, authenticated;
revoke execute on function public.seed_notification_rules_for_new_org() from public, anon, authenticated;
