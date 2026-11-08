-- Renewal requests, hardening (from the security review of the two previous
-- migrations):
--
-- 1. A repeat request from the public page used to overwrite the phone and
--    note on the pending row. Anyone who knows a card number could have
--    pointed the desk at a different phone. The first phone and note now stay;
--    a repeat only bumps the count and the time. The desk also has the
--    member's own phone from the member record.
--
-- 2. Reading and handling a request follows the member's branch, the way the
--    rest of the desk does: owners see all, everyone else sees members at
--    branches they cover.

create or replace function public.public_renewal_request(
  p_org_slug text,
  p_card_no integer,
  p_phone text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hit record;
  v_phone text := nullif(left(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), 20), '');
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  v_row public.renewal_requests%rowtype;
begin
  select * into v_hit from public.public_card_lookup(p_org_slug, p_card_no);

  if v_hit.outcome = 'org_not_found' then
    return jsonb_build_object('result', 'org_not_found');
  elsif v_hit.outcome <> 'ok' then
    return jsonb_build_object('result', v_hit.outcome, 'card_no', public.format_card_no(p_card_no));
  end if;

  select * into v_row
  from public.renewal_requests r
  where r.member_id = v_hit.member_id
    and r.status = 'pending'::public.renewal_request_status
  for update;

  if found then
    if v_row.last_requested_at > now() - interval '10 minutes' then
      return jsonb_build_object('result', 'too_soon', 'card_no', public.format_card_no(p_card_no));
    end if;

    -- First word stands: a later caller may only add what was missing.
    update public.renewal_requests r
    set request_count = r.request_count + 1,
        last_requested_at = now(),
        phone = coalesce(r.phone, v_phone),
        note = coalesce(r.note, v_note),
        card_stock_id = coalesce(r.card_stock_id, v_hit.stock_id)
    where r.id = v_row.id;
  else
    insert into public.renewal_requests (org_id, member_id, card_stock_id, phone, note)
    values (v_hit.org_id, v_hit.member_id, v_hit.stock_id, v_phone, v_note);
  end if;

  return jsonb_build_object('result', 'ok', 'card_no', public.format_card_no(p_card_no));
end;
$$;

create or replace function public.handle_renewal_request(
  p_request_id uuid,
  p_status public.renewal_request_status,
  p_note text default null
)
returns public.renewal_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := public.jwt_org_id();
  v_staff_id uuid := public.jwt_staff_id();
  v_row public.renewal_requests%rowtype;
begin
  if v_org_id is null or v_staff_id is null or not public.jwt_can_serve_members() then
    raise exception 'Only front desk, managers and owners can handle renewal requests'
      using errcode = 'insufficient_privilege';
  end if;

  if p_status = 'pending'::public.renewal_request_status then
    raise exception 'A request is closed as done or rejected'
      using errcode = 'check_violation';
  end if;

  select r.* into v_row
  from public.renewal_requests r
  join public.members m on m.id = r.member_id
  where r.id = p_request_id
    and r.org_id = v_org_id
    and (public.jwt_is_owner() or public.has_branch_access(m.home_branch_id))
  for update of r;
  if not found then
    raise exception 'Renewal request not found' using errcode = 'no_data_found';
  end if;

  if v_row.status <> 'pending'::public.renewal_request_status then
    raise exception 'This request was already %', v_row.status
      using errcode = 'check_violation';
  end if;

  update public.renewal_requests r
  set status = p_status,
      handled_by = v_staff_id,
      handled_at = now(),
      handled_note = nullif(btrim(coalesce(p_note, '')), '')
  where r.id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

drop policy "staff read renewal requests in their org" on public.renewal_requests;

create policy "staff read renewal requests at their branches"
  on public.renewal_requests for select to authenticated
  using (
    public.is_org_member(org_id)
    and public.jwt_is_staff()
    and (
      public.jwt_is_owner()
      or exists (
        select 1 from public.members m
        where m.id = member_id
          and public.has_branch_access(m.home_branch_id)
      )
    )
  );
