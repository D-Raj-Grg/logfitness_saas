-- Phase 4 -- Personal-training sessions. A pt_session is one 1:1 appointment
-- between a trainer and a member. Writes happen only through the RPCs below
-- (no insert/update policy exists), so every rule lives in one place and the
-- session-pack decrement is atomic with completing the session.

create type public.pt_session_status as enum ('scheduled', 'completed', 'cancelled');

create table public.pt_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  branch_id uuid not null,
  trainer_id uuid not null,
  member_id uuid not null,
  membership_id uuid,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes between 5 and 480),
  status public.pt_session_status not null default 'scheduled',
  notes text,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pt_sessions_id_org_id_key unique (id, org_id),
  constraint pt_sessions_branch_fkey
    foreign key (branch_id, org_id) references public.branches (id, org_id)
    deferrable initially deferred,
  constraint pt_sessions_trainer_fkey
    foreign key (trainer_id, org_id) references public.staff (id, org_id),
  constraint pt_sessions_member_fkey
    foreign key (member_id, org_id) references public.members (id, org_id)
    on delete cascade,
  constraint pt_sessions_membership_fkey
    foreign key (membership_id, org_id) references public.memberships (id, org_id),
  constraint pt_sessions_completed_has_timestamp
    check (status <> 'completed' or completed_at is not null),
  constraint pt_sessions_cancelled_has_timestamp
    check (status <> 'cancelled' or cancelled_at is not null)
);

create index pt_sessions_branch_scheduled_idx on public.pt_sessions (org_id, branch_id, scheduled_at);
create index pt_sessions_trainer_scheduled_idx on public.pt_sessions (trainer_id, scheduled_at);
create index pt_sessions_member_idx on public.pt_sessions (member_id, scheduled_at desc);
create index pt_sessions_membership_idx on public.pt_sessions (membership_id) where membership_id is not null;

create trigger pt_sessions_set_updated_at
  before update on public.pt_sessions
  for each row execute function public.set_updated_at();

create trigger pt_sessions_audit
  after insert or update or delete on public.pt_sessions
  for each row execute function public.audit_row();

alter table public.pt_sessions enable row level security;

create policy "staff read pt sessions in their org"
  on public.pt_sessions for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

create policy "members read their own pt sessions"
  on public.pt_sessions for select to authenticated
  using (public.jwt_is_member() and member_id = public.jwt_member_id());

-- book_pt_session ---------------------------------------------------------------
create or replace function public.book_pt_session(
  p_member_id uuid,
  p_trainer_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer default 60,
  p_notes text default null,
  p_membership_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members%rowtype;
  v_trainer public.staff%rowtype;
  v_ms public.memberships%rowtype;
  v_pending integer;
  v_row public.pt_sessions%rowtype;
begin
  if p_scheduled_at is null or p_duration_minutes is null
     or p_duration_minutes < 5 or p_duration_minutes > 480 then
    raise exception 'Choose a start time and a duration between 5 and 480 minutes'
      using errcode = 'check_violation';
  end if;

  select * into v_member from public.members where id = p_member_id;
  if not found or not public.is_org_member(v_member.org_id)
     or not public.has_branch_access(v_member.home_branch_id) then
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;

  -- Front desk, managers and owners book for anyone; a trainer books only
  -- sessions of their own.
  if not (
    public.jwt_can_serve_members()
    or (public.jwt_staff_role() = 'trainer'::public.staff_role
        and p_trainer_id = public.jwt_staff_id())
  ) then
    raise exception 'You cannot book a personal-training session for this trainer'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_trainer from public.staff where id = p_trainer_id and org_id = v_member.org_id;
  if not found or v_trainer.status <> 'active'::public.staff_status
     or not (v_trainer.role = 'owner'::public.staff_role
             or v_member.home_branch_id = any (v_trainer.branch_ids)) then
    raise exception 'That trainer does not work at the member''s branch'
      using errcode = 'check_violation';
  end if;

  -- One trainer cannot be in two sessions at once.
  if exists (
    select 1 from public.pt_sessions s
    where s.trainer_id = p_trainer_id
      and s.status = 'scheduled'::public.pt_session_status
      and tstzrange(s.scheduled_at, s.scheduled_at + make_interval(mins => s.duration_minutes))
          && tstzrange(p_scheduled_at, p_scheduled_at + make_interval(mins => p_duration_minutes))
  ) then
    raise exception 'The trainer already has a session at that time'
      using errcode = 'check_violation';
  end if;

  if p_membership_id is not null then
    select * into v_ms from public.memberships
     where id = p_membership_id and member_id = v_member.id and org_id = v_member.org_id;
    if not found or v_ms.status <> 'active'::public.membership_status then
      raise exception 'That membership is not active for this member'
        using errcode = 'check_violation';
    end if;
  else
    select m.* into v_ms
    from public.memberships m
    where m.member_id = v_member.id
      and m.status = 'active'::public.membership_status
    order by (m.plan_type = 'session_pack'::public.plan_type) desc, m.end_date nulls last
    limit 1;
    if not found then
      raise exception 'Member does not have an active membership'
        using errcode = 'check_violation';
    end if;
  end if;

  if v_ms.plan_type = 'session_pack'::public.plan_type then
    select count(*) into v_pending from public.pt_sessions s
     where s.membership_id = v_ms.id and s.status = 'scheduled'::public.pt_session_status;
    if coalesce(v_ms.sessions_remaining, 0) - v_pending <= 0 then
      raise exception 'No sessions left on this member''s pack (including ones already booked)'
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.pt_sessions (
    org_id, branch_id, trainer_id, member_id, membership_id,
    scheduled_at, duration_minutes, notes, created_by
  )
  values (
    v_member.org_id, v_member.home_branch_id, p_trainer_id, v_member.id, v_ms.id,
    p_scheduled_at, p_duration_minutes, nullif(btrim(p_notes), ''), public.jwt_staff_id()
  )
  returning * into v_row;

  return jsonb_build_object('pt_session_id', v_row.id, 'membership_id', v_ms.id, 'status', v_row.status);
end;
$$;

revoke execute on function public.book_pt_session(uuid, uuid, timestamptz, integer, text, uuid) from public, anon;
grant execute on function public.book_pt_session(uuid, uuid, timestamptz, integer, text, uuid) to authenticated;

-- complete_pt_session -----------------------------------------------------------
create or replace function public.complete_pt_session(p_pt_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.pt_sessions%rowtype;
  v_ms public.memberships%rowtype;
  v_remaining integer;
begin
  select * into v_s from public.pt_sessions where id = p_pt_session_id for update;
  if not found or not public.is_org_member(v_s.org_id) or not public.has_branch_access(v_s.branch_id) then
    raise exception 'Personal-training session not found' using errcode = 'no_data_found';
  end if;

  if not (
    public.jwt_is_owner()
    or public.jwt_staff_role() = 'manager'::public.staff_role
    or (public.jwt_staff_role() = 'trainer'::public.staff_role and v_s.trainer_id = public.jwt_staff_id())
  ) then
    raise exception 'Only the trainer, a manager or an owner can complete this session'
      using errcode = 'insufficient_privilege';
  end if;

  if v_s.status <> 'scheduled'::public.pt_session_status then
    raise exception 'This session is already %', v_s.status using errcode = 'check_violation';
  end if;

  if v_s.membership_id is not null then
    select * into v_ms from public.memberships where id = v_s.membership_id for update;
    if v_ms.plan_type = 'session_pack'::public.plan_type then
      if v_ms.status <> 'active'::public.membership_status then
        raise exception 'The member''s pack is no longer active' using errcode = 'check_violation';
      end if;
      if coalesce(v_ms.sessions_remaining, 0) <= 0 then
        raise exception 'No sessions left on this member''s pack' using errcode = 'check_violation';
      end if;
      update public.memberships
         set sessions_remaining = sessions_remaining - 1
       where id = v_ms.id
       returning sessions_remaining into v_remaining;
    end if;
  end if;

  update public.pt_sessions
     set status = 'completed', completed_at = now()
   where id = v_s.id;

  return jsonb_build_object('pt_session_id', v_s.id, 'status', 'completed', 'sessions_remaining', v_remaining);
end;
$$;

revoke execute on function public.complete_pt_session(uuid) from public, anon;
grant execute on function public.complete_pt_session(uuid) to authenticated;

-- cancel_pt_session -------------------------------------------------------------
create or replace function public.cancel_pt_session(p_pt_session_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.pt_sessions%rowtype;
begin
  select * into v_s from public.pt_sessions where id = p_pt_session_id for update;
  if not found or not public.is_org_member(v_s.org_id) or not public.has_branch_access(v_s.branch_id) then
    raise exception 'Personal-training session not found' using errcode = 'no_data_found';
  end if;

  if not (
    public.jwt_can_serve_members()
    or (public.jwt_staff_role() = 'trainer'::public.staff_role and v_s.trainer_id = public.jwt_staff_id())
  ) then
    raise exception 'You cannot cancel this session' using errcode = 'insufficient_privilege';
  end if;

  if v_s.status <> 'scheduled'::public.pt_session_status then
    raise exception 'This session is already %', v_s.status using errcode = 'check_violation';
  end if;

  update public.pt_sessions
     set status = 'cancelled', cancelled_at = now(), cancel_reason = nullif(btrim(p_reason), '')
   where id = v_s.id;

  return jsonb_build_object('pt_session_id', v_s.id, 'status', 'cancelled');
end;
$$;

revoke execute on function public.cancel_pt_session(uuid, text) from public, anon;
grant execute on function public.cancel_pt_session(uuid, text) to authenticated;
