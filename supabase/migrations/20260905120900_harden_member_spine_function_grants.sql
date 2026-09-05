-- Supabase grants EXECUTE on every public function to anon and authenticated by
-- default. Phase 0 pared that back for its own functions; this does the same for
-- the member spine, and demotes the two helpers that had no business being
-- SECURITY DEFINER in the first place.

-- Both read only rows the caller is already entitled to, so they can run as the
-- caller. Inside a SECURITY DEFINER trigger the current user is the owner, so
-- the trigger paths keep working unchanged.
create or replace function public.org_today(p_org_id uuid)
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select (
    now() at time zone coalesce(
      (select o.timezone from public.orgs o where o.id = p_org_id),
      'Asia/Kathmandu'
    )
  )::date;
$$;

create or replace function public.plan_sold_at(p_plan_id uuid, p_branch_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.membership_plans p
    where p.id = p_plan_id
      and (
        coalesce(array_length(p.branch_ids, 1), 0) = 0
        or p_branch_id = any (p.branch_ids)
      )
  );
$$;

-- Nothing in this phase is callable without signing in.
revoke execute on function public.org_today(uuid) from public, anon;
revoke execute on function public.plan_sold_at(uuid, uuid) from public, anon;
revoke execute on function public.jwt_can_serve_members() from public, anon;
revoke execute on function public.daily_collection(date, uuid) from public, anon;
revoke execute on function public.arrears_report(uuid) from public, anon;
revoke execute on function public.renew_membership(
  uuid, uuid, uuid, date, bigint, bigint, public.payment_method, text, text
) from public, anon;
revoke execute on function public.record_payment(
  uuid, bigint, public.payment_method, text, text
) from public, anon;
revoke execute on function public.refund_payment(
  uuid, bigint, text, public.payment_method, text
) from public, anon;
revoke execute on function public.freeze_membership(uuid, text) from public, anon;
revoke execute on function public.unfreeze_membership(uuid) from public, anon;
revoke execute on function public.cancel_membership(uuid, text) from public, anon;
revoke execute on function public.set_member_left(uuid, text, date) from public, anon;
revoke execute on function public.reactivate_member(uuid) from public, anon;

-- Re-granted after the blanket revoke, which also strips authenticated.
grant execute on function public.org_today(uuid) to authenticated;
grant execute on function public.plan_sold_at(uuid, uuid) to authenticated;
grant execute on function public.jwt_can_serve_members() to authenticated;
grant execute on function public.daily_collection(date, uuid) to authenticated;
grant execute on function public.arrears_report(uuid) to authenticated;
grant execute on function public.renew_membership(
  uuid, uuid, uuid, date, bigint, bigint, public.payment_method, text, text
) to authenticated;
grant execute on function public.record_payment(
  uuid, bigint, public.payment_method, text, text
) to authenticated;
grant execute on function public.refund_payment(
  uuid, bigint, text, public.payment_method, text
) to authenticated;
grant execute on function public.freeze_membership(uuid, text) to authenticated;
grant execute on function public.unfreeze_membership(uuid) to authenticated;
grant execute on function public.cancel_membership(uuid, text) to authenticated;
grant execute on function public.set_member_left(uuid, text, date) to authenticated;
grant execute on function public.reactivate_member(uuid) to authenticated;

revoke all on public.member_overview from anon;

-- public.org_counters keeps RLS on with no policies on purpose: the counters are
-- reachable only through public.next_org_counter(), which is SECURITY DEFINER.
revoke all on public.org_counters from anon, authenticated;
