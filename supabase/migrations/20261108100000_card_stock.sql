-- Printed card numbers. A gym buys blank RFID cards and prints a number on
-- each ("NO. 0004"). The number is the card's name for the rest of its life:
-- the desk finds, hands out, takes back and re-issues a card by that number
-- without scanning anything. It is NOT the member's identity -- members.member_code
-- stays immutable per member; a card is refundable and moves between members.
--
-- So a printed card is stock, kept in card_stock, one row per physical card:
--   card_no   the printed number, unique per org
--   card_uid  the chip inside, learnt the first time it is tapped or typed
--   qr_token  a random secret minted at print time; not yet used by the QR
--             (which carries the plain number) but stored now so a later signed
--             link needs no reprint
--   status    free | lost | retired. "assigned" is never stored: whether a
--             card is in someone's hand is derived from the live member_cards /
--             staff_cards row for its uid, so taking a card back (revoke) frees
--             the stock with no second write to forget.
--
-- Assignment itself stays in member_cards through assign_member_card(); the
-- stock RPCs only translate a printed number into a uid and hand over.

create type public.card_stock_status as enum ('free', 'lost', 'retired');

-- One print run. Lets the designer re-download the same PDF later.
create table public.card_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  design_id uuid,
  from_no integer not null,
  to_no integer not null,
  created_by uuid,
  created_at timestamptz not null default now(),

  constraint card_batches_id_org_id_key unique (id, org_id),
  constraint card_batches_range_check check (from_no >= 1 and to_no >= from_no and to_no <= 9999),
  constraint card_batches_created_by_fkey
    foreign key (created_by, org_id) references public.staff (id, org_id)
    on delete set null (created_by)
);

create index card_batches_org_idx on public.card_batches (org_id, created_at desc);

create table public.card_stock (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  card_no integer not null,
  qr_token text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  card_uid text,
  status public.card_stock_status not null default 'free',
  status_reason text,
  batch_id uuid,
  design_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint card_stock_id_org_id_key unique (id, org_id),
  constraint card_stock_org_card_no_key unique (org_id, card_no),
  constraint card_stock_org_qr_token_key unique (org_id, qr_token),
  constraint card_stock_card_no_check check (card_no between 1 and 9999),
  constraint card_stock_card_uid_check
    check (card_uid is null or card_uid ~ '^[0-9A-F]{8,20}$'),
  constraint card_stock_status_reason_check
    check (
      status = 'free'::public.card_stock_status
      or length(btrim(coalesce(status_reason, ''))) > 0
    ),
  constraint card_stock_batch_fkey
    foreign key (batch_id, org_id) references public.card_batches (id, org_id)
    on delete set null (batch_id),
  constraint card_stock_created_by_fkey
    foreign key (created_by, org_id) references public.staff (id, org_id)
    on delete set null (created_by)
);

-- A chip is one physical card. Lost and retired rows keep their uid so the
-- same chip can never be given a second number.
create unique index card_stock_org_uid_key
  on public.card_stock (org_id, card_uid)
  where card_uid is not null;

comment on table public.card_stock is
  'Printed RFID cards, one row per physical card. Written only through the card stock RPCs (security definer); staff read their org''s rows. Whether a card is in someone''s hand is derived from member_cards/staff_cards, see card_stock_overview.';
comment on column public.card_stock.card_no is
  'The number printed on the card. Unique per org, immutable, reused across members as the card changes hands.';
comment on column public.card_stock.qr_token is
  'Random secret minted at print time. Reserved for a signed balance link; the printed QR carries the plain card number today.';

-- The printed number and the token are on the plastic; they do not move. The
-- chip may be set once, and swapped only while nobody holds the card.
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
     and public.card_uid_holder_kind(old.org_id, old.card_uid) is not null
  then
    raise exception 'Card % is in someone''s hand; revoke it before changing its chip',
      public.format_card_no(old.card_no)
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

-- Who holds this chip right now: 'member', 'staff' or null. Security definer
-- so the answer does not depend on which staff_cards rows the caller may see
-- (a front desk user sees only their own) -- the view and the RPCs need the
-- truth, not the caller's slice. Returns only the kind, never the name.
create or replace function public.card_uid_holder_kind(p_org_id uuid, p_card_uid text)
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

-- "NO. 0004", "0004", "04", "4" are all card 4. Null when there is no number
-- in the text or it is outside the printable range.
create or replace function public.parse_card_no(p_text text)
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when digits = '' then null
    when length(digits) > 4 then null
    when digits::integer between 1 and 9999 then digits::integer
    else null
  end
  from (select regexp_replace(coalesce(p_text, ''), '[^0-9]', '', 'g') as digits) d;
$$;

create or replace function public.format_card_no(p_no integer)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select lpad(p_no::text, 4, '0');
$$;

create trigger card_stock_guard_immutability
  before update on public.card_stock
  for each row execute function public.guard_card_stock_immutability();

create trigger card_stock_set_updated_at
  before update on public.card_stock
  for each row execute function public.set_updated_at();

-- Cards carry a refundable fee; who numbered, linked and lost them is worth a row.
create trigger card_stock_audit
  after insert or delete or update on public.card_stock
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- RPCs

-- Number a run of blank cards. Owner or manager: it is a purchasing decision.
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

-- The number the next print run would start at. Reads under RLS.
create or replace function public.next_free_card_no()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(max(cs.card_no), 0) + 1
  from public.card_stock cs
  where cs.org_id = public.jwt_org_id();
$$;

-- Tell card 0004 which chip is inside it. Member-facing staff: it is desk
-- work. A chip already live for anyone, or already another number, is refused.
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

  v_holder := public.card_uid_holder_kind(v_org_id, v_uid);
  if v_holder = 'member' then
    raise exception 'That chip is already assigned to a member'
      using errcode = 'unique_violation';
  elsif v_holder = 'staff' then
    raise exception 'That chip is already assigned to a staff member'
      using errcode = 'unique_violation';
  end if;

  if v_stock.card_uid is not null
     and public.card_uid_holder_kind(v_org_id, v_stock.card_uid) is not null
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

-- Hand card 0004 to a member by its number. Security invoker: it only looks
-- the chip up (under RLS) and then calls assign_member_card, so the member_cards
-- insert policy, the one-holder-per-uid trigger and the audit all apply as
-- they would at the old dialog. With p_card_uid it also links a chip that was
-- never tapped before -- the "type the number, tap the card" path.
create or replace function public.assign_card_stock_to_member(
  p_member_id uuid,
  p_card_no integer,
  p_card_uid text default null,
  p_replace boolean default false
)
returns public.member_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid := public.jwt_org_id();
  v_stock public.card_stock%rowtype;
  v_uid text;
begin
  if v_org_id is null or not public.jwt_can_serve_members() then
    raise exception 'Only front desk, managers and owners can assign cards'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_stock
  from public.card_stock cs
  where cs.org_id = v_org_id and cs.card_no = p_card_no;
  if not found then
    raise exception 'No card numbered %', public.format_card_no(p_card_no)
      using errcode = 'no_data_found';
  end if;

  if v_stock.status <> 'free'::public.card_stock_status then
    raise exception 'Card % is marked %', public.format_card_no(p_card_no), v_stock.status
      using errcode = 'check_violation';
  end if;

  if p_card_uid is not null and btrim(p_card_uid) <> '' then
    v_uid := public.normalize_card_uid(p_card_uid);
    if v_stock.card_uid is null then
      v_stock := public.link_card_stock_uid(p_card_no, v_uid);
    elsif v_stock.card_uid <> v_uid then
      raise exception 'Card % holds a different chip', public.format_card_no(p_card_no)
        using errcode = 'unique_violation';
    end if;
  end if;

  if v_stock.card_uid is null then
    raise exception 'Card % has no chip linked yet. Tap it on a reader or type its UID.',
      public.format_card_no(p_card_no)
      using errcode = 'check_violation';
  end if;

  return public.assign_member_card(p_member_id, v_stock.card_uid, p_replace);
end;
$$;

-- Lost, retired, or found again. A card in someone's hand is taken back
-- (revoke) first; this only speaks for cards on the shelf.
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
     and public.card_uid_holder_kind(v_org_id, v_stock.card_uid) is not null
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

-- ---------------------------------------------------------------------------
-- What the cards screen shows. effective_status folds the live assignment in;
-- the holder's name is given for members only (member_cards is readable by all
-- staff), never for staff.
create or replace view public.card_stock_overview
with (security_invoker = true)
as
select
  s.id,
  s.org_id,
  s.card_no,
  public.format_card_no(s.card_no) as card_no_text,
  s.card_uid,
  s.qr_token,
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

-- ---------------------------------------------------------------------------
-- member_overview learns the printed number of the member's live card.
-- Appended at the end: `create or replace view` is add-only.
create or replace view public.member_overview
with (security_invoker = true)
as
select
  m.id,
  m.org_id,
  m.home_branch_id,
  b.name as home_branch_name,
  m.member_code,
  m.full_name,
  m.phone,
  m.email,
  m.photo_path,
  m.status,
  m.joined_on,
  m.left_on,
  cur.id as current_membership_id,
  cur.plan_id as current_plan_id,
  cur.plan_name as current_plan_name,
  cur.plan_type as current_plan_type,
  cur.status as membership_status,
  cur.start_date as membership_start_date,
  cur.end_date as membership_end_date,
  cur.sessions_remaining,
  case
    when cur.end_date is null then null::integer
    else cur.end_date - public.org_today(m.org_id)
  end as days_to_expiry,
  coalesce(dues.due_paisa, 0::numeric) as due_paisa,
  dues.oldest_due_on,
  exists (
    select 1 from public.memberships ms where ms.member_id = m.id
  ) as has_membership_history,
  m.archived_at,
  (
    select a.attended_on
    from public.attendance a
    where a.member_id = m.id
    order by a.checked_in_at desc
    limit 1
  ) as last_visit_on,
  -- The printed number of the card in this member's hand, if the chip is
  -- numbered stock. Both sides are covered by partial unique indexes.
  (
    select cs.card_no
    from public.member_cards mc
    join public.card_stock cs on cs.org_id = mc.org_id and cs.card_uid = mc.card_uid
    where mc.member_id = m.id and mc.revoked_at is null
    limit 1
  ) as card_no
from public.members m
join public.branches b on b.id = m.home_branch_id
left join lateral (
  select ms.*
  from public.memberships ms
  where ms.member_id = m.id
    and ms.status = any (
      array['active'::public.membership_status,
            'upcoming'::public.membership_status,
            'frozen'::public.membership_status]
    )
  order by coalesce(ms.end_date, '9999-12-31'::date) desc, ms.start_date desc
  limit 1
) cur on true
left join lateral (
  select sum(i.due_paisa) as due_paisa, min(i.issued_on) as oldest_due_on
  from public.invoices i
  where i.member_id = m.id
    and i.status = any (
      array['unpaid'::public.invoice_status, 'partial'::public.invoice_status]
    )
    and i.due_paisa > 0
) dues on true;

-- RLS ------------------------------------------------------------------------
alter table public.card_batches enable row level security;
alter table public.card_stock enable row level security;

create policy "staff read card batches in their org"
  on public.card_batches for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

create policy "staff read card stock in their org"
  on public.card_stock for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

-- No write policies, and no write privilege either: every write goes through
-- the definer RPCs above, so a direct write is refused outright rather than
-- filtered to zero rows.
revoke insert, update, delete on public.card_batches from anon, authenticated;
revoke insert, update, delete on public.card_stock from anon, authenticated;

-- Grants -----------------------------------------------------------------------
revoke execute on function public.guard_card_stock_immutability() from public, anon, authenticated;
revoke execute on function public.card_uid_holder_kind(uuid, text) from public, anon;
revoke execute on function public.parse_card_no(text) from public, anon;
revoke execute on function public.format_card_no(integer) from public, anon;
revoke execute on function public.create_card_stock_range(integer, integer, uuid) from public, anon;
revoke execute on function public.next_free_card_no() from public, anon;
revoke execute on function public.link_card_stock_uid(integer, text) from public, anon;
revoke execute on function public.assign_card_stock_to_member(uuid, integer, text, boolean) from public, anon;
revoke execute on function public.set_card_stock_status(integer, public.card_stock_status, text) from public, anon;

grant execute on function public.card_uid_holder_kind(uuid, text) to authenticated;
grant execute on function public.parse_card_no(text) to authenticated;
grant execute on function public.format_card_no(integer) to authenticated;
grant execute on function public.create_card_stock_range(integer, integer, uuid) to authenticated;
grant execute on function public.next_free_card_no() to authenticated;
grant execute on function public.link_card_stock_uid(integer, text) to authenticated;
grant execute on function public.assign_card_stock_to_member(uuid, integer, text, boolean) to authenticated;
grant execute on function public.set_card_stock_status(integer, public.card_stock_status, text) to authenticated;

revoke all on public.card_stock_overview from public, anon;
grant select on public.card_stock_overview to authenticated;
revoke all on public.member_overview from public, anon;
grant select on public.member_overview to authenticated;
