-- Two things 20260917100100 got wrong, both of them the same mistake: a stored
-- status that stops being true while nobody is looking.
--
-- 1. `announcements.status` is written once, at send. A scheduled announcement
--    therefore still reads `scheduled` a week after it went out, and the list
--    says "Not sent yet" about messages that were delivered on Tuesday. The
--    column is kept -- it records what was *asked for*, which is worth having
--    -- and the view now derives what is actually true from the outbox, which
--    is the only thing that knows.
--
-- 2. `cancel_announcement` marked the announcement cancelled even when it had
--    stopped nothing, so a send that had already completed could be made to
--    look cancelled after the fact. Cancelling nothing now changes nothing.

-- Dropped rather than replaced: `state` lands between two existing columns,
-- and Postgres will not let a replacement rename a view column in place.
drop view if exists public.announcement_overview;

create view public.announcement_overview
with (security_invoker = true) as
select
  a.id,
  a.org_id,
  a.branch_id,
  b.name as branch_name,
  a.title,
  a.body,
  a.channel,
  a.audience,
  a.member_statuses,
  a.visitor_days,
  a.status,
  -- What is true now, rather than what was true at the moment of composing.
  -- Order matters: cancelled beats everything, an hour that has not arrived
  -- beats the counts, and anything still queued is moving rather than done.
  case
    when a.status = 'cancelled'::public.announcement_status then 'cancelled'
    when a.scheduled_for > now() then 'scheduled'
    when coalesce(m.queued, 0) > 0 then 'sending'
    else 'sent'
  end as state,
  a.scheduled_for,
  a.created_at,
  a.created_by,
  s.full_name as created_by_name,
  coalesce(m.total, 0)::integer as total,
  coalesce(m.queued, 0)::integer as queued,
  coalesce(m.sent, 0)::integer as sent,
  coalesce(m.failed, 0)::integer as failed,
  coalesce(m.skipped, 0)::integer as skipped,
  coalesce(m.cancelled, 0)::integer as cancelled,
  m.last_sent_at
from public.announcements a
left join public.branches b on b.id = a.branch_id and b.org_id = a.org_id
left join public.staff s on s.id = a.created_by and s.org_id = a.org_id
left join lateral (
  select
    count(*) as total,
    count(*) filter (where n.status in ('queued'::public.notification_status,
                                        'sending'::public.notification_status)) as queued,
    count(*) filter (where n.status = 'sent'::public.notification_status) as sent,
    count(*) filter (where n.status = 'failed'::public.notification_status) as failed,
    count(*) filter (where n.status = 'skipped'::public.notification_status) as skipped,
    count(*) filter (where n.status = 'cancelled'::public.notification_status) as cancelled,
    max(n.sent_at) as last_sent_at
  from public.notification_messages n
  where n.announcement_id = a.id and n.org_id = a.org_id
) m on true;

comment on view public.announcement_overview is
  'One row per broadcast with its delivery counted off the outbox. `status` is what was asked for; `state` is what is true now.';

revoke all on public.announcement_overview from public, anon;
grant select on public.announcement_overview to authenticated;

-- Cancelling nothing is not a cancellation.
create or replace function public.cancel_announcement(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.jwt_org_id();
  v_row public.announcements%rowtype;
  v_n integer := 0;
begin
  if v_org is null or not public.jwt_is_staff()
     or public.jwt_staff_role() not in ('owner'::public.staff_role, 'manager'::public.staff_role) then
    raise exception 'Only an owner or manager can cancel an announcement'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.announcements
  where id = p_id and org_id = v_org;

  if v_row.id is null then
    raise exception 'That announcement no longer exists'
      using errcode = 'no_data_found';
  end if;

  update public.notification_messages
     set status = 'cancelled'::public.notification_status,
         last_error = 'The announcement was cancelled'
   where announcement_id = p_id
     and org_id = v_org
     and status = 'queued'::public.notification_status;

  get diagnostics v_n = row_count;

  -- An announcement whose messages have all left is history, not something
  -- that can be called back, and saying otherwise in the log would be the
  -- record disagreeing with what members actually received.
  if v_n > 0 then
    update public.announcements
       set status = 'cancelled'::public.announcement_status
     where id = p_id and org_id = v_org;
  end if;

  return v_n;
end;
$$;

revoke execute on function public.cancel_announcement(uuid) from public, anon;
grant execute on function public.cancel_announcement(uuid) to authenticated;
