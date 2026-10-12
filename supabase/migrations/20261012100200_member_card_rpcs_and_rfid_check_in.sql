-- RFID check-in, part 3 -- cards and the door. attendance_snapshot() is the
-- membership/dues/banner read that check_in_member does inline, lifted out
-- verbatim so the reader and the desk judge a member by the same rules.
-- check_in_member itself is left untouched: its signature and body are the
-- Flutter app's contract.
--
-- assign/revoke are security invoker -- they are ordinary staff writes and
-- member_cards RLS is the boundary. rfid_check_in is the one exception: it is
-- called by the rfid-check Edge Function with the service-role key on behalf
-- of a device that has no JWT, so it is security definer, executable by
-- service_role only, and derives org and branch from the device key alone.

-- What the desk would be shown for this member right now. Zero rows when the
-- member is not visible to the caller.
create or replace function public.attendance_snapshot(p_member_id uuid)
returns table (
  membership_id uuid,
  membership_status public.membership_status,
  plan_name text,
  days_to_expiry integer,
  sessions_remaining integer,
  due_paisa bigint,
  banner text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    ms.id,
    ms.status,
    ms.plan_name,
    d.days,
    ms.sessions_remaining,
    due.due_paisa,
    public.attendance_banner(m.status, ms.status, d.days, ms.sessions_remaining)
  from public.members m
  -- The membership the desk should be looking at: the live one, else the one
  -- that ran out most recently, so an expired member still gets a real date on
  -- screen instead of a blank.
  left join lateral (
    select *
    from public.memberships ms
    where ms.member_id = m.id
      and ms.status <> 'cancelled'::public.membership_status
    order by
      (ms.status in (
        'active'::public.membership_status,
        'frozen'::public.membership_status,
        'upcoming'::public.membership_status
      )) desc,
      coalesce(ms.end_date, '9999-12-31'::date) desc,
      ms.start_date desc
    limit 1
  ) ms on true
  cross join lateral (
    select case
      when ms.end_date is null then null
      else ms.end_date - public.org_today(m.org_id)
    end as days
  ) d
  cross join lateral (
    select coalesce(sum(i.due_paisa), 0)::bigint as due_paisa
    from public.invoices i
    where i.member_id = m.id
      and i.status in ('unpaid'::public.invoice_status, 'partial'::public.invoice_status)
      and i.due_paisa > 0
  ) due
  where m.id = p_member_id;
$$;

-- Card UIDs arrive as "04:A3:1B:...", "04 a3 1b" or "04A31B". Store one form.
create or replace function public.normalize_card_uid(p_card_uid text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_card_uid, ''), '[^0-9A-Fa-f]', '', 'g'));
$$;

-- Give a member a card. A member holds at most one live card: replacing one
-- needs p_replace, which revokes the old card with reason 'Replaced'. A card
-- that is live for someone else is refused by name, so the desk knows whose
-- card it is holding.
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

  -- The card is no longer a stranger at any reader in this org.
  delete from public.unassigned_card_scans s
  where s.org_id = v_member.org_id and s.card_uid = v_uid;

  return v_row;
end;
$$;

-- Lost, stolen, handed back. The reason is the record.
create or replace function public.revoke_member_card(
  p_member_id uuid,
  p_reason text
)
returns public.member_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_staff_id uuid := public.jwt_staff_id();
  v_row public.member_cards%rowtype;
begin
  if v_staff_id is null or not public.jwt_can_serve_members() then
    raise exception 'Only front desk, managers and owners can revoke cards'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Revoking a card needs a reason'
      using errcode = 'check_violation';
  end if;

  update public.member_cards mc
  set revoked_at = now(),
      revoked_by = v_staff_id,
      revoke_reason = btrim(p_reason)
  where mc.member_id = p_member_id and mc.revoked_at is null
  returning * into v_row;

  if not found then
    raise exception 'This member has no active card' using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$$;

-- The door. Called only by the rfid-check Edge Function (service role), which
-- has already turned the device key into its sha256. Never raises for a
-- business outcome: every refusal is a jsonb answer the reader can show.
--
-- p_scanned_at is the reader's RTC time. It is accepted for the record but the
-- server clock decides the gym day -- a device clock is not evidence.
create or replace function public.rfid_check_in(
  p_key_hash text,
  p_card_uid text,
  p_scanned_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device record;
  v_uid text;
  v_member public.members%rowtype;
  v_snap record;
  v_banner text;
  v_allowed boolean;
  v_reason text;
  v_today date;
  v_existing_id uuid;
  v_attendance_id uuid;
begin
  -- 1. Which reader is this?
  select d.id, d.org_id, d.branch_id, d.name, d.status, b.name as branch_name
    into v_device
  from public.devices d
  join public.branches b on b.id = d.branch_id
  where d.key_hash = p_key_hash;

  if not found then
    return jsonb_build_object('decision', 'deny', 'reason', 'device_unknown');
  end if;

  if v_device.status = 'disabled'::public.device_status then
    return jsonb_build_object(
      'decision', 'deny', 'reason', 'device_disabled',
      'device_name', v_device.name, 'branch_name', v_device.branch_name
    );
  end if;

  update public.devices d set last_seen_at = now() where d.id = v_device.id;

  -- 2. A UID the reader could not read cleanly.
  v_uid := public.normalize_card_uid(p_card_uid);
  if v_uid !~ '^[0-9A-F]{8,20}$' then
    return jsonb_build_object(
      'decision', 'deny', 'reason', 'bad_uid',
      'device_name', v_device.name, 'branch_name', v_device.branch_name
    );
  end if;

  -- 3. Whose card? A stranger goes to the enrollment inbox.
  select m.* into v_member
  from public.member_cards mc
  join public.members m on m.id = mc.member_id
  where mc.org_id = v_device.org_id
    and mc.card_uid = v_uid
    and mc.revoked_at is null;

  if not found then
    insert into public.unassigned_card_scans (
      org_id, branch_id, device_id, card_uid, first_seen_at, last_seen_at, scan_count
    )
    values (
      v_device.org_id, v_device.branch_id, v_device.id, v_uid, now(), now(), 1
    )
    on conflict (device_id, card_uid) do update
    set last_seen_at = now(),
        branch_id = excluded.branch_id,
        scan_count = public.unassigned_card_scans.scan_count + 1;

    delete from public.unassigned_card_scans s
    where s.device_id = v_device.id
      and s.last_seen_at < now() - interval '7 days';

    return jsonb_build_object(
      'decision', 'deny', 'reason', 'unknown_card',
      'device_name', v_device.name, 'branch_name', v_device.branch_name
    );
  end if;

  -- 4. What would the desk see? An archived member is gone, whatever their
  -- last membership says.
  select * into v_snap from public.attendance_snapshot(v_member.id);
  v_banner := case when v_member.archived_at is not null then 'left' else v_snap.banner end;

  -- 5. Allow only a current membership with nothing owing.
  v_allowed := v_banner in ('active', 'expiring') and coalesce(v_snap.due_paisa, 0) = 0;
  v_reason := case when coalesce(v_snap.due_paisa, 0) > 0 then 'dues' else v_banner end;

  -- 6. Already in today? A second tap is a no-op, not a second visit.
  v_today := public.org_today(v_device.org_id);

  select a.id into v_existing_id
  from public.attendance a
  where a.member_id = v_member.id and a.attended_on = v_today
  order by a.checked_in_at desc
  limit 1;

  -- 7. Write the visit. Denied taps write nothing.
  if v_allowed and v_existing_id is null then
    begin
      insert into public.attendance (
        org_id, branch_id, member_id, membership_id, method,
        checked_in_at, attended_on,
        membership_status_at_checkin, days_to_expiry_at_checkin, due_paisa_at_checkin,
        checked_in_by, device_id
      )
      values (
        v_device.org_id, v_device.branch_id, v_member.id, v_snap.membership_id,
        'card'::public.attendance_method,
        now(), v_today,
        v_snap.membership_status, v_snap.days_to_expiry, coalesce(v_snap.due_paisa, 0),
        null, v_device.id
      )
      returning id into v_attendance_id;
    exception when unique_violation then
      -- Two taps raced; the other one won.
      select a.id into v_existing_id
      from public.attendance a
      where a.member_id = v_member.id and a.attended_on = v_today
      order by a.checked_in_at desc
      limit 1;
    end;
  end if;

  -- 8. The reader's answer.
  return jsonb_build_object(
    'decision', case when v_allowed then 'allow' else 'deny' end,
    'reason', v_reason,
    'member_name', v_member.full_name,
    'member_code', v_member.member_code,
    'status', v_banner,
    'days_to_expiry', v_snap.days_to_expiry,
    'due_paisa', coalesce(v_snap.due_paisa, 0),
    'already_checked_in_today', v_existing_id is not null,
    'attendance_id', coalesce(v_attendance_id, v_existing_id),
    'branch_name', v_device.branch_name,
    'device_name', v_device.name
  );
end;
$$;

-- Grant hygiene. rfid_check_in is for the Edge Function's service-role client
-- only; a signed-in user calling it directly would be a device impersonator.
revoke execute on function public.attendance_snapshot(uuid) from public, anon;
revoke execute on function public.normalize_card_uid(text) from public, anon;
revoke execute on function public.assign_member_card(uuid, text, boolean) from public, anon;
revoke execute on function public.revoke_member_card(uuid, text) from public, anon;
revoke execute on function public.rfid_check_in(text, text, timestamptz) from public, anon, authenticated;

grant execute on function public.attendance_snapshot(uuid) to authenticated;
grant execute on function public.normalize_card_uid(text) to authenticated;
grant execute on function public.assign_member_card(uuid, text, boolean) to authenticated;
grant execute on function public.revoke_member_card(uuid, text) to authenticated;
grant execute on function public.rfid_check_in(text, text, timestamptz) to service_role;
