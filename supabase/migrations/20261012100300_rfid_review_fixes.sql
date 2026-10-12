-- RFID check-in, review fixes.
--
-- 1. assign_member_card cleared the enrollment inbox with its own (invoker)
--    delete, which the branch-scoped delete policy on unassigned_card_scans
--    narrowed to the desk's own branches. A card tapped at another branch kept
--    sitting in that branch's inbox after it was assigned. The cleanup now goes
--    through clear_unassigned_card_scans(), a small definer helper.
--
--    That helper is granted to authenticated rather than hidden: assign_member_card
--    is security invoker, so it can only call functions its caller may execute.
--    Exposing it is harmless by construction -- it takes the org from the JWT,
--    refuses anyone who cannot serve members, and only deletes inbox rows for a
--    uid that is already a live card in that org, i.e. rows that are stale anyway.
--
-- 2. Human check-ins can no longer name a reader. "member-facing staff check
--    members in" gains `device_id is null`; only rfid_check_in (definer, owner
--    bypasses RLS) writes device_id. Without this a desk could fake a
--    "Device · Front door" visit through PostgREST.
--
-- 3. A card cannot be inserted already revoked (which would let a desk sign a
--    revocation in someone else's name): the insert policy requires the revoke
--    columns to be null.
--
-- Known and accepted: attendance.device_id is `on delete set null (device_id)`,
-- but guard_attendance_immutability forbids changing device_id, so deleting a
-- device -- or a branch, which cascades to its devices -- that has card visits
-- raises restrict_violation. There is no delete path for devices (disable
-- only), and checked_in_by has carried the same pattern since Phase 2.

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
    and exists (
      select 1 from public.member_cards mc
      where mc.org_id = v_org_id
        and mc.card_uid = v_uid
        and mc.revoked_at is null
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.assign_member_card(
  p_member_id uuid,
  p_card_uid text,
  p_replace boolean default false
)
returns public.member_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid text := public.normalize_card_uid(p_card_uid);
  v_staff_id uuid := public.jwt_staff_id();
  v_member public.members%rowtype;
  v_live public.member_cards%rowtype;
  v_holder text;
  v_row public.member_cards%rowtype;
begin
  if v_staff_id is null or not public.jwt_can_serve_members() then
    raise exception 'Only front desk, managers and owners can assign cards'
      using errcode = 'insufficient_privilege';
  end if;

  if v_uid !~ '^[0-9A-F]{8,20}$' then
    raise exception 'A card UID is 8 to 20 hex characters'
      using errcode = 'check_violation';
  end if;

  select * into v_member from public.members m where m.id = p_member_id;
  if not found then
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;

  select m.member_code into v_holder
  from public.member_cards mc
  join public.members m on m.id = mc.member_id
  where mc.org_id = v_member.org_id
    and mc.card_uid = v_uid
    and mc.revoked_at is null
    and mc.member_id <> v_member.id;
  if found then
    raise exception 'That card belongs to %', v_holder
      using errcode = 'unique_violation';
  end if;

  select * into v_live
  from public.member_cards mc
  where mc.member_id = v_member.id and mc.revoked_at is null;

  if found and v_live.card_uid = v_uid then
    -- Already this member's card: nothing to change.
    v_row := v_live;
  else
    if found then
      if not coalesce(p_replace, false) then
        raise exception 'This member already has a card; replace it instead'
          using errcode = 'unique_violation';
      end if;

      update public.member_cards mc
      set revoked_at = now(),
          revoked_by = v_staff_id,
          revoke_reason = 'Replaced'
      where mc.id = v_live.id;
    end if;

    insert into public.member_cards (org_id, member_id, card_uid, assigned_by)
    values (v_member.org_id, v_member.id, v_uid, v_staff_id)
    returning * into v_row;
  end if;

  -- The card is no longer a stranger at any reader in this org -- including
  -- branches this desk cannot reach, which its own RLS-bound delete would miss.
  perform public.clear_unassigned_card_scans(v_uid);

  return v_row;
end;
$$;

drop policy "member-facing staff check members in" on public.attendance;
create policy "member-facing staff check members in"
  on public.attendance for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and public.has_branch_access(branch_id)
    and (checked_in_by = public.jwt_staff_id() or public.jwt_is_owner())
    and device_id is null
  );

drop policy "member-facing staff assign cards" on public.member_cards;
create policy "member-facing staff assign cards"
  on public.member_cards for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and public.jwt_can_serve_members()
    and assigned_by = public.jwt_staff_id()
    and revoked_at is null
    and revoked_by is null
    and revoke_reason is null
  );

revoke execute on function public.clear_unassigned_card_scans(text) from public, anon;
grant execute on function public.clear_unassigned_card_scans(text) to authenticated;
