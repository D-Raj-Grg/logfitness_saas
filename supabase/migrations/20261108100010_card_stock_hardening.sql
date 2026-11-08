-- Card stock, hardening. Two things the first migration got loose:
--
-- 1. card_uid_holder_kind(org, uid) was a security definer any signed-in user
--    could call with ANY org id -- a cross-tenant probe for "is this chip live
--    over there". The unguarded lookup moves to card_uid_holder_kind_internal,
--    executable by nobody from the API (trigger and definer RPCs only), and the
--    public name becomes a wrapper that answers only for the caller's own org.
--
-- 2. card_stock_overview carried qr_token. The token is reserved for a signed
--    balance link; nothing on screen needs it, so the screen view drops it.
--    Staff who need it later read card_stock directly (same RLS).

create or replace function public.card_uid_holder_kind_internal(p_org_id uuid, p_card_uid text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.member_cards mc
      where mc.org_id = p_org_id and mc.card_uid = p_card_uid and mc.revoked_at is null
    ) then 'member'
    when exists (
      select 1 from public.staff_cards sc
      where sc.org_id = p_org_id and sc.card_uid = p_card_uid and sc.revoked_at is null
    ) then 'staff'
  end;
$$;

-- Same answer, but only about the caller's own org, and only for staff.
create or replace function public.card_uid_holder_kind(p_org_id uuid, p_card_uid text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_org_id = public.jwt_org_id() and public.jwt_is_staff()
      then public.card_uid_holder_kind_internal(p_org_id, p_card_uid)
  end;
$$;

-- The trigger and the definer RPCs ask the unguarded one: a superuser fixing
-- data has no JWT, and a definer RPC has already checked the caller's org.
create or replace function public.guard_card_stock_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.org_id is distinct from old.org_id
     or new.card_no is distinct from old.card_no
     or new.qr_token is distinct from old.qr_token
     or new.created_at is distinct from old.created_at
  then
    raise exception 'A printed card''s number and token are immutable'
      using errcode = 'restrict_violation';
  end if;

  if old.card_uid is not null
     and new.card_uid is distinct from old.card_uid
     and public.card_uid_holder_kind_internal(old.org_id, old.card_uid) is not null
  then
    raise exception 'Card % is in someone''s hand; revoke it before changing its chip',
      public.format_card_no(old.card_no)
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create or replace function public.link_card_stock_uid(
  p_card_no integer,
  p_card_uid text
)
returns public.card_stock
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := public.jwt_org_id();
  v_uid text := public.normalize_card_uid(p_card_uid);
  v_stock public.card_stock%rowtype;
  v_other integer;
  v_holder text;
begin
  if v_org_id is null or not public.jwt_can_serve_members() then
    raise exception 'Only front desk, managers and owners can link cards'
      using errcode = 'insufficient_privilege';
  end if;

  if v_uid !~ '^[0-9A-F]{8,20}$' then
    raise exception 'A card UID is 8 to 20 hex characters'
      using errcode = 'check_violation';
  end if;

  select * into v_stock
  from public.card_stock cs
  where cs.org_id = v_org_id and cs.card_no = p_card_no
  for update;
  if not found then
    raise exception 'No card numbered %', public.format_card_no(p_card_no)
      using errcode = 'no_data_found';
  end if;

  if v_stock.card_uid = v_uid then
    return v_stock;
  end if;

  if v_stock.status <> 'free'::public.card_stock_status then
    raise exception 'Card % is marked %', public.format_card_no(p_card_no), v_stock.status
      using errcode = 'check_violation';
  end if;

  select cs.card_no into v_other
  from public.card_stock cs
  where cs.org_id = v_org_id and cs.card_uid = v_uid and cs.id <> v_stock.id;
  if found then
    raise exception 'That chip is card %', public.format_card_no(v_other)
      using errcode = 'unique_violation';
  end if;

  v_holder := public.card_uid_holder_kind_internal(v_org_id, v_uid);
  if v_holder = 'member' then
    raise exception 'That chip is already assigned to a member'
      using errcode = 'unique_violation';
  elsif v_holder = 'staff' then
    raise exception 'That chip is already assigned to a staff member'
      using errcode = 'unique_violation';
  end if;

  if v_stock.card_uid is not null
     and public.card_uid_holder_kind_internal(v_org_id, v_stock.card_uid) is not null
  then
    raise exception 'Card % is in someone''s hand; revoke it before changing its chip',
      public.format_card_no(p_card_no)
      using errcode = 'restrict_violation';
  end if;

  update public.card_stock cs
  set card_uid = v_uid
  where cs.id = v_stock.id
  returning * into v_stock;

  return v_stock;
end;
$$;

create or replace function public.set_card_stock_status(
  p_card_no integer,
  p_status public.card_stock_status,
  p_reason text default null
)
returns public.card_stock
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := public.jwt_org_id();
  v_stock public.card_stock%rowtype;
begin
  if v_org_id is null or not public.jwt_can_serve_members() then
    raise exception 'Only front desk, managers and owners can change card status'
      using errcode = 'insufficient_privilege';
  end if;

  if p_status <> 'free'::public.card_stock_status
     and length(btrim(coalesce(p_reason, ''))) = 0
  then
    raise exception 'Marking a card % needs a reason', p_status
      using errcode = 'check_violation';
  end if;

  select * into v_stock
  from public.card_stock cs
  where cs.org_id = v_org_id and cs.card_no = p_card_no
  for update;
  if not found then
    raise exception 'No card numbered %', public.format_card_no(p_card_no)
      using errcode = 'no_data_found';
  end if;

  if v_stock.card_uid is not null
     and public.card_uid_holder_kind_internal(v_org_id, v_stock.card_uid) is not null
  then
    raise exception 'Card % is in someone''s hand; revoke it first',
      public.format_card_no(p_card_no)
      using errcode = 'restrict_violation';
  end if;

  update public.card_stock cs
  set status = p_status,
      status_reason = case
        when p_status = 'free'::public.card_stock_status then null
        else btrim(p_reason)
      end
  where cs.id = v_stock.id
  returning * into v_stock;

  return v_stock;
end;
$$;

-- Same view minus qr_token. Dropping a column needs drop + create.
drop view public.card_stock_overview;
create view public.card_stock_overview
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
  select public.card_uid_holder_kind(s.org_id, s.card_uid) as kind
) hk
left join public.member_cards mc
  on mc.org_id = s.org_id and mc.card_uid = s.card_uid and mc.revoked_at is null
left join public.members m on m.id = mc.member_id;

revoke execute on function public.card_uid_holder_kind_internal(uuid, text) from public, anon, authenticated;
revoke execute on function public.card_uid_holder_kind(uuid, text) from public, anon;
grant execute on function public.card_uid_holder_kind(uuid, text) to authenticated;

revoke all on public.card_stock_overview from public, anon;
grant select on public.card_stock_overview to authenticated;
