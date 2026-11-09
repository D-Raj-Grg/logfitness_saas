-- Review fix: the public page could be scripted over 0001..9999 to drop one
-- pending renewal request on every member of a gym in a single pass. Per-member
-- too_soon does not stop that; a per-org cap does. More than 30 requests in an
-- hour across the whole org and new ones are answered too_soon (the member's
-- phone number is on the card page copy; the desk is a call away). Repeats on
-- an existing pending row are unaffected.

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
  v_recent integer;
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
    select count(*) into v_recent
    from public.renewal_requests r
    where r.org_id = v_hit.org_id
      and r.requested_at > now() - interval '1 hour';
    if v_recent >= 30 then
      return jsonb_build_object('result', 'too_soon', 'card_no', public.format_card_no(p_card_no));
    end if;

    insert into public.renewal_requests (org_id, member_id, card_stock_id, phone, note)
    values (v_hit.org_id, v_hit.member_id, v_hit.stock_id, v_phone, v_note)
    on conflict (member_id) where status = 'pending'::public.renewal_request_status do nothing;
    v_inserted := found;

    if v_inserted then
      return jsonb_build_object('result', 'ok', 'card_no', public.format_card_no(p_card_no));
    end if;

    select * into v_row
    from public.renewal_requests r
    where r.member_id = v_hit.member_id
      and r.status = 'pending'::public.renewal_request_status
    for update;
  end if;

  if v_row.last_requested_at > now() - interval '10 minutes' then
    return jsonb_build_object('result', 'too_soon', 'card_no', public.format_card_no(p_card_no));
  end if;

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

create index if not exists renewal_requests_org_requested_idx
  on public.renewal_requests (org_id, requested_at desc);
