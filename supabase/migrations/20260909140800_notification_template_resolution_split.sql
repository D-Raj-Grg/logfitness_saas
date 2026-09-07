-- A correction to the correction, caught by re-running the sweep as pg_cron
-- actually runs it -- with no JWT claims at all.
--
-- The previous migration made `resolve_notification_template` SECURITY INVOKER
-- with an `is_org_member(p_org_id)` guard, to stop one gym reading another's
-- wording. That closed the hole and broke the product: the three nightly
-- enqueue jobs call this function, cron holds no claims, so the guard was false
-- for every org, the lateral join produced no row, and
-- `enqueue_renewal_reminders()` returned 0 for a gym with a member expiring in
-- seven days. Reminders would have stopped silently -- the worst possible
-- failure for this feature, because nothing errors and nobody is told.
--
-- The two callers want different things, so they get different functions:
--
--   resolve_notification_template  SECURITY DEFINER, revoked from every client
--                                  role. The sweeps only. A trusted internal
--                                  caller resolving wording for an org it holds
--                                  no claims for is the whole job.
--   notification_template_preview  SECURITY INVOKER, granted to authenticated.
--                                  The settings screen. The org's own row comes
--                                  back through RLS; a call for someone else's
--                                  org returns nothing.
--
-- Note what the guard is and is not protecting. The org's own wording is
-- protected by RLS on `notification_templates` once the function is invoker.
-- The other branch returns the built-in default, which is a constant and
-- identical for every gym -- the guard there buys a clean contract ("you get
-- nothing for an org that is not yours"), not secrecy.

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

comment on function public.resolve_notification_template(uuid, public.notification_event, public.notification_channel, text) is
  'Internal: what the nightly sweeps render from. Not callable by any client role -- the console uses notification_template_preview.';

create or replace function public.notification_template_preview(
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
    and public.jwt_is_staff()
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

revoke execute on function public.resolve_notification_template(uuid, public.notification_event, public.notification_channel, text) from public, anon, authenticated;

revoke execute on function public.notification_template_preview(uuid, public.notification_event, public.notification_channel, text) from public, anon;
grant execute on function public.notification_template_preview(uuid, public.notification_event, public.notification_channel, text) to authenticated;
