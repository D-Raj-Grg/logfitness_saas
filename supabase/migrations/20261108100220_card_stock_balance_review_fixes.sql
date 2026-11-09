-- Review fixes for the card stock / balance migrations.
--
-- 1. Two first taps on "Request renewal" at the same instant both missed the
--    pending row and both inserted; the loser hit the partial unique index
--    and the member saw a 500. The insert now steps aside on conflict and the
--    second caller is answered too_soon like any repeat.
-- 2. Two managers numbering overlapping ranges at once got Postgres's raw
--    duplicate-key text instead of "Card 0005 already exists". The range RPC
--    takes a per-org advisory lock around the clash check.
-- 3. A member marked left whose card was never revoked still had a live public
--    page. They collapse to card_unassigned like an archived member.
-- 4. card_stock_overview no longer asks who holds a chip for rows that have no
--    chip; and the two views drop the default write privileges authenticated
--    inherited (harmless under security_invoker, but against the house rule).

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
  v_inserted boolean := false;
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

  if not found then
    insert into public.renewal_requests (org_id, member_id, card_stock_id, phone, note)
    values (v_hit.org_id, v_hit.member_id, v_hit.stock_id, v_phone, v_note)
    on conflict (member_id) where status = 'pending'::public.renewal_request_status do nothing;
    v_inserted := found;

    if v_inserted then
      return jsonb_build_object('result', 'ok', 'card_no', public.format_card_no(p_card_no));
    end if;

    -- Someone else inserted between our select and insert: it is a repeat.
    select * into v_row
    from public.renewal_requests r
    where r.member_id = v_hit.member_id
      and r.status = 'pending'::public.renewal_request_status
    for update;
  end if;

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

  return jsonb_build_object('result', 'ok', 'card_no', public.format_card_no(p_card_no));
end;
$$;

create or replace function public.create_card_stock_range(
  p_from integer,
  p_to integer,
  p_design_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := public.jwt_org_id();
  v_staff_id uuid := public.jwt_staff_id();
  v_clash integer;
  v_batch_id uuid;
  v_created integer;
begin
  if v_org_id is null or v_staff_id is null
     or not coalesce(
       public.jwt_staff_role() in ('owner'::public.staff_role, 'manager'::public.staff_role),
       false
     )
  then
    raise exception 'Only owners and managers can number cards'
      using errcode = 'insufficient_privilege';
  end if;

  if p_from is null or p_to is null or p_from < 1 or p_to > 9999 or p_to < p_from then
    raise exception 'A card range runs from 1 to 9999, low to high'
      using errcode = 'check_violation';
  end if;

  if p_to - p_from + 1 > 500 then
    raise exception 'Number at most 500 cards at a time'
      using errcode = 'check_violation';
  end if;

  -- One numbering at a time per org, so the clash check below is the truth.
  perform pg_advisory_xact_lock(hashtextextended('card_stock_range:' || v_org_id::text, 0));

  select min(cs.card_no) into v_clash
  from public.card_stock cs
  where cs.org_id = v_org_id and cs.card_no between p_from and p_to;
  if v_clash is not null then
    raise exception 'Card % already exists', public.format_card_no(v_clash)
      using errcode = 'unique_violation';
  end if;

  insert into public.card_batches (org_id, design_id, from_no, to_no, created_by)
  values (v_org_id, p_design_id, p_from, p_to, v_staff_id)
  returning id into v_batch_id;

  insert into public.card_stock (org_id, card_no, batch_id, design_id, created_by)
  select v_org_id, g, v_batch_id, p_design_id, v_staff_id
  from generate_series(p_from, p_to) as g;
  get diagnostics v_created = row_count;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'from_no', p_from,
    'to_no', p_to,
    'created', v_created
  );
end;
$$;

create or replace function public.public_card_lookup(p_org_slug text, p_card_no integer)
returns table (
  outcome text,
  org_id uuid,
  stock_id uuid,
  member_id uuid,
  full_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_stock public.card_stock%rowtype;
  v_member public.members%rowtype;
begin
  select o.id into v_org_id from public.orgs o where o.slug = p_org_slug;
  if not found then
    return query select 'org_not_found', null::uuid, null::uuid, null::uuid, null::text;
    return;
  end if;

  select * into v_stock
  from public.card_stock cs
  where cs.org_id = v_org_id and cs.card_no = p_card_no;
  if not found then
    return query select 'card_not_found', v_org_id, null::uuid, null::uuid, null::text;
    return;
  end if;

  if v_stock.card_uid is null or v_stock.status <> 'free'::public.card_stock_status then
    return query select 'card_unassigned', v_org_id, v_stock.id, null::uuid, null::text;
    return;
  end if;

  -- Archived or left: the card should have come back; the page says so.
  select m.* into v_member
  from public.member_cards mc
  join public.members m on m.id = mc.member_id
  where mc.org_id = v_org_id
    and mc.card_uid = v_stock.card_uid
    and mc.revoked_at is null
    and m.archived_at is null
    and m.status <> 'left'::public.member_status;
  if not found then
    return query select 'card_unassigned', v_org_id, v_stock.id, null::uuid, null::text;
    return;
  end if;

  return query select 'ok', v_org_id, v_stock.id, v_member.id, v_member.full_name;
end;
$$;

create or replace view public.card_stock_overview
with (security_invoker = true)
as
select
  s.id,
  s.org_id,
  s.card_no,
  public.format_card_no(s.card_no) as card_no_text,
  s.card_uid,
  s.status,
  s.status_reason,
  s.batch_id,
  s.design_id,
  s.created_by,
  s.created_at,
  s.updated_at,
  hk.kind as holder_kind,
  case when hk.kind is not null then 'assigned' else s.status::text end as effective_status,
  mc.member_id,
  m.member_code,
  m.full_name as holder_name,
  mc.assigned_at
from public.card_stock s
cross join lateral (
  select case
    when s.card_uid is null then null
    else public.card_uid_holder_kind(s.org_id, s.card_uid)
  end as kind
) hk
left join public.member_cards mc
  on mc.org_id = s.org_id and mc.card_uid = s.card_uid and mc.revoked_at is null
left join public.members m on m.id = mc.member_id;

revoke all on public.card_stock_overview from public, anon, authenticated;
grant select on public.card_stock_overview to authenticated;
revoke all on public.member_overview from public, anon, authenticated;
grant select on public.member_overview to authenticated;
