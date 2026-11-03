-- Tightening staff_cards after a security review of 20261104110000.
--
-- 1. Direct writes were weaker than assign_staff_card. A manager could insert a
--    row through the API that skipped the "must be active" check, backdated
--    assigned_at, or arrived already revoked. The door still denies inactive
--    staff, so access was never affected, but the assignment history is
--    evidence and should not be writable to taste. A before-insert trigger now
--    forces the timestamps to now(), requires an active target and refuses a
--    pre-revoked row; the revoke path stamps revoked_at itself, so a revocation
--    cannot be backdated or future-dated either.
--
-- 2. The read policy let any manager read every card UID in the org, owners'
--    and other branches' included. A card UID is what a cloned card presents at
--    the door, so it should be readable only by the people who may assign it:
--    owners read all; a manager reads their own card and the cards of front desk
--    and trainers at a branch they share; everyone reads their own.

create or replace function public.prepare_staff_card_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.revoked_at is not null or new.revoked_by is not null or new.revoke_reason is not null then
    raise exception 'A card is assigned live; revoke it afterwards'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.staff s
    where s.id = new.staff_id
      and s.org_id = new.org_id
      and s.status = 'active'::public.staff_status
  ) then
    raise exception 'Activate this person before giving them a card'
      using errcode = 'check_violation';
  end if;

  new.assigned_at := now();
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create trigger staff_cards_prepare
  before insert on public.staff_cards
  for each row execute function public.prepare_staff_card_row();

-- Same guard as before, plus: revoking stamps revoked_at with the server's now().
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

  if old.revoked_at is null and new.revoked_at is not null then
    new.revoked_at := now();
  end if;

  return new;
end;
$$;

-- The insert policy also refuses any row that is not a plain live assignment.
drop policy "owners and managers assign staff cards" on public.staff_cards;
create policy "owners and managers assign staff cards"
  on public.staff_cards for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and assigned_by = public.jwt_staff_id()
    and revoked_at is null
    and revoked_by is null
    and revoke_reason is null
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

-- Read: the people who may assign a card may read it; everyone reads their own.
drop policy "owners and managers read staff cards" on public.staff_cards;
create policy "staff cards are readable by those who may assign them"
  on public.staff_cards for select to authenticated
  using (
    public.is_org_member(org_id)
    and (
      staff_id = public.jwt_staff_id()
      or public.jwt_is_owner()
      or (
        public.jwt_staff_role() = 'manager'::public.staff_role
        and exists (
          select 1 from public.staff t
          where t.id = staff_cards.staff_id
            and t.org_id = staff_cards.org_id
            and t.role in ('front_desk'::public.staff_role, 'trainer'::public.staff_role)
            and t.branch_ids && public.jwt_branch_ids()
        )
      )
    )
  );

revoke execute on function public.prepare_staff_card_row() from public, anon, authenticated;
