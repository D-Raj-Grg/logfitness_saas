-- Staff cards, part 1 -- the table and the rule that keeps a card UID with one
-- holder.
--
-- A staff card is the same kind of physical RFID card a member carries, bound to
-- a staff row instead of a member row. It lives in its own table rather than a
-- polymorphic holder column: member_cards is read by the door function, the
-- Flutter app and the card RPCs, and loosening its foreign key to serve two
-- kinds of holder would have touched every one of them.
--
-- What the two tables cannot say on their own is "a UID is live for at most one
-- holder across BOTH". The unique indexes only see their own table. So a
-- before-insert trigger on each asks the other. The check takes an advisory
-- lock on (org, uid) first, otherwise two assignments racing into different
-- tables would each look at the other, find nothing, and both commit.

create table public.staff_cards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  staff_id uuid not null,
  card_uid text not null,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint staff_cards_card_uid_check
    check (card_uid ~ '^[0-9A-F]{8,20}$'),
  constraint staff_cards_revoke_needs_reason
    check (
      revoked_at is null
      or length(btrim(coalesce(revoke_reason, ''))) > 0
    ),
  constraint staff_cards_staff_fkey
    foreign key (staff_id, org_id) references public.staff (id, org_id)
    on delete cascade,
  constraint staff_cards_assigned_by_fkey
    foreign key (assigned_by, org_id) references public.staff (id, org_id)
    on delete set null (assigned_by),
  constraint staff_cards_revoked_by_fkey
    foreign key (revoked_by, org_id) references public.staff (id, org_id)
    on delete set null (revoked_by)
);

create unique index staff_cards_live_uid_key
  on public.staff_cards (org_id, card_uid)
  where revoked_at is null;
create unique index staff_cards_live_staff_key
  on public.staff_cards (staff_id)
  where revoked_at is null;

comment on table public.staff_cards is
  'RFID cards held by staff. At most one live card per staff member, and a UID is live for one holder across staff_cards AND member_cards. Revoked rows are history.';

-- Same rule as member cards: an assignment is evidence of who held a card when,
-- and the only change ever allowed is revoking it, once.
create or replace function public.guard_staff_card_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.org_id is distinct from old.org_id
     or new.staff_id is distinct from old.staff_id
     or new.card_uid is distinct from old.card_uid
     or new.assigned_by is distinct from old.assigned_by
     or new.assigned_at is distinct from old.assigned_at
     or new.created_at is distinct from old.created_at
  then
    raise exception 'A card assignment is immutable; revoke it and assign a new one'
      using errcode = 'restrict_violation';
  end if;

  if (old.revoked_at is not null or new.revoked_at is null)
     and (
       new.revoked_at is distinct from old.revoked_at
       or new.revoked_by is distinct from old.revoked_by
       or new.revoke_reason is distinct from old.revoke_reason
     )
  then
    raise exception 'A card can be revoked once and never un-revoked'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger staff_cards_guard_immutability
  before update on public.staff_cards
  for each row execute function public.guard_staff_card_immutability();

create trigger staff_cards_set_updated_at
  before update on public.staff_cards
  for each row execute function public.set_updated_at();

create trigger staff_cards_audit
  after insert or delete or update on public.staff_cards
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- One holder per UID, across both tables.
--
-- security definer because the person assigning a member's card (front desk)
-- cannot read staff_cards under RLS, and the whole point is to look. The message
-- never names the holder: a front-desk user learning which colleague owns a card
-- is more than they need.
create or replace function public.assert_card_uid_free()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_taken boolean;
begin
  if new.revoked_at is not null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.org_id::text || ':' || new.card_uid, 0));

  if tg_table_name = 'member_cards' then
    select exists (
      select 1 from public.staff_cards sc
      where sc.org_id = new.org_id and sc.card_uid = new.card_uid and sc.revoked_at is null
    ) into v_taken;
    if v_taken then
      raise exception 'That card is already assigned to a staff member'
        using errcode = 'unique_violation';
    end if;
  else
    select exists (
      select 1 from public.member_cards mc
      where mc.org_id = new.org_id and mc.card_uid = new.card_uid and mc.revoked_at is null
    ) into v_taken;
    if v_taken then
      raise exception 'That card is already assigned to a member'
        using errcode = 'unique_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger member_cards_card_uid_free
  before insert on public.member_cards
  for each row execute function public.assert_card_uid_free();

create trigger staff_cards_card_uid_free
  before insert on public.staff_cards
  for each row execute function public.assert_card_uid_free();

-- ---------------------------------------------------------------------------
-- The enrollment inbox clears a card's unknown-tap rows once the card belongs to
-- someone. It only knew about member cards; a card handed to a staff member must
-- clear it too, or it would sit in the inbox offering itself to the next member.
-- Signature, security and grants are unchanged.
create or replace function public.clear_unassigned_card_scans(p_card_uid text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := public.jwt_org_id();
  v_uid text := public.normalize_card_uid(p_card_uid);
  v_deleted integer;
begin
  if v_org_id is null or not public.jwt_can_serve_members() then
    raise exception 'Only front desk, managers and owners can clear card scans'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.unassigned_card_scans s
  where s.org_id = v_org_id
    and s.card_uid = v_uid
    and (
      exists (
        select 1 from public.member_cards mc
        where mc.org_id = v_org_id
          and mc.card_uid = v_uid
          and mc.revoked_at is null
      )
      or exists (
        select 1 from public.staff_cards sc
        where sc.org_id = v_org_id
          and sc.card_uid = v_uid
          and sc.revoked_at is null
      )
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS. Owners and managers read every card in the org (the staff list already
-- shows them every colleague); a staff member reads their own. Writes are for
-- owners and managers only, and the policy applies the same ceiling the staff
-- screen does: an owner may serve anyone, a manager only front desk and
-- trainers at a branch they share. assign_staff_card / revoke_staff_card give
-- the readable errors; this is the backstop behind them.
alter table public.staff_cards enable row level security;

create policy "owners and managers read staff cards"
  on public.staff_cards for select to authenticated
  using (
    public.is_org_member(org_id)
    and (
      staff_id = public.jwt_staff_id()
      or public.jwt_staff_role() in ('owner'::public.staff_role, 'manager'::public.staff_role)
    )
  );

create policy "owners and managers assign staff cards"
  on public.staff_cards for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and assigned_by = public.jwt_staff_id()
    and public.jwt_staff_role() in ('owner'::public.staff_role, 'manager'::public.staff_role)
    and exists (
      select 1 from public.staff t
      where t.id = staff_cards.staff_id
        and t.org_id = staff_cards.org_id
        and (
          public.jwt_is_owner()
          or (
            t.role in ('front_desk'::public.staff_role, 'trainer'::public.staff_role)
            and t.branch_ids && public.jwt_branch_ids()
          )
        )
    )
  );

create policy "owners and managers revoke staff cards"
  on public.staff_cards for update to authenticated
  using (
    public.is_org_member(org_id)
    and public.jwt_staff_role() in ('owner'::public.staff_role, 'manager'::public.staff_role)
    and exists (
      select 1 from public.staff t
      where t.id = staff_cards.staff_id
        and t.org_id = staff_cards.org_id
        and (
          public.jwt_is_owner()
          or (
            t.role in ('front_desk'::public.staff_role, 'trainer'::public.staff_role)
            and t.branch_ids && public.jwt_branch_ids()
          )
        )
    )
  )
  with check (
    public.is_org_member(org_id)
    and revoked_by = public.jwt_staff_id()
  );

-- No delete policy: revoked rows are the history.

-- Grants: these are triggers and a definer helper, not RPCs. Re-asserted for
-- clear_unassigned_card_scans because create or replace keeps grants, and this
-- states what they are.
revoke all on public.staff_cards from public, anon;
grant select, insert, update on public.staff_cards to authenticated;

revoke execute on function public.guard_staff_card_immutability() from public, anon, authenticated;
revoke execute on function public.assert_card_uid_free() from public, anon, authenticated;
revoke execute on function public.clear_unassigned_card_scans(text) from public, anon;
grant execute on function public.clear_unassigned_card_scans(text) to authenticated;
