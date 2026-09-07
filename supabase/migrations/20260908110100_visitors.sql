-- Visitors: the people who walked in but are not members yet.
--
-- Two kinds of person arrive at a desk that has nowhere to put them. Someone
-- asking what a month costs, who leaves with a price and no record -- and
-- someone here to train for a day as a guest. Both end up on a paper pad, and
-- the pad is where the callback dies.
--
-- Scope decision (2026-09-08): this is a log, not a CRM. `docs/PRD.md` names a
-- lead pipeline a non-goal and it stays one. One row per person who walked in,
-- four statuses, one note, and a button that turns them into a member. No
-- reminders, no assignment, no campaigns, no funnel report. Drip follow-ups are
-- a new scope decision, not an extension of this.

create type public.visitor_kind as enum ('enquiry', 'guest');
create type public.visitor_status as enum ('new', 'contacted', 'converted', 'lost');

create table public.visitors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,

  -- The branch they walked into. Not nullable: a walk-in happens somewhere,
  -- and it is what scopes who may write the row.
  branch_id uuid not null,

  kind public.visitor_kind not null default 'enquiry',

  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  phone text not null check (length(btrim(phone)) between 1 and 30),

  -- The "auto date". Filled by trigger from the org's own today, because
  -- Kathmandu's day is not UTC's, and left editable so the desk can log
  -- yesterday's walk-in this morning.
  visited_on date not null,

  note text,

  -- What they asked about. Set null rather than blocking if the plan is
  -- later deleted -- the visit still happened.
  interested_plan_id uuid,

  status public.visitor_status not null default 'new',
  converted_member_id uuid,
  converted_at timestamptz,

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, org_id),

  -- Converted is a fact about a member existing, so the two move together.
  -- Every other status carries no member.
  constraint visitors_converted_shape check (
    (status = 'converted' and converted_member_id is not null and converted_at is not null)
    or (status <> 'converted' and converted_member_id is null and converted_at is null)
  )
);

alter table public.visitors
  add constraint visitors_branch_id_fkey
    foreign key (branch_id, org_id)
    references public.branches (id, org_id) on delete cascade,
  add constraint visitors_interested_plan_id_fkey
    foreign key (interested_plan_id, org_id)
    references public.membership_plans (id, org_id) on delete set null,
  add constraint visitors_converted_member_id_fkey
    foreign key (converted_member_id, org_id)
    references public.members (id, org_id) on delete set null,
  add constraint visitors_created_by_fkey
    foreign key (created_by, org_id)
    references public.staff (id, org_id) on delete set null;

-- The list: this branch, newest visit first.
create index visitors_org_branch_visited_idx
  on public.visitors (org_id, branch_id, visited_on desc);

-- "Who still needs calling back" is the only status filter that matters, and
-- it shrinks as the log grows, so the index carries the open minority only.
create index visitors_open_idx
  on public.visitors (org_id, status)
  where status in ('new'::public.visitor_status, 'contacted'::public.visitor_status);

-- Someone who enquired last month and walks back in is looked up by phone.
create index visitors_org_phone_idx on public.visitors (org_id, phone);

-- The auto date, and the author. Both are facts about the act of logging, so
-- they are filled here rather than trusted from the client. Either may be
-- supplied explicitly: the desk backdates a visit, and a seed has no JWT.
create or replace function public.set_visitor_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.visited_on is null then
    new.visited_on := public.org_today(new.org_id);
  end if;

  if new.created_by is null then
    new.created_by := public.jwt_staff_id();
  end if;

  return new;
end;
$$;

create trigger visitors_set_defaults
  before insert on public.visitors
  for each row execute function public.set_visitor_defaults();

create trigger visitors_set_updated_at
  before update on public.visitors
  for each row execute function public.set_updated_at();

create trigger visitors_audit
  after insert or update or delete on public.visitors
  for each row execute function public.audit_row();

-- RLS ------------------------------------------------------------------------
alter table public.visitors enable row level security;

-- Read is org-wide like members: someone who enquired at one branch and walks
-- into another must be found, not logged twice. `jwt_is_staff()` because a
-- member's token also carries org_id, and this is a staff-only record.
create policy "staff read visitors in their org"
  on public.visitors for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

-- Every role logs a visitor, trainers included: a walk-in asks whoever is
-- standing there. Writes stay inside the branches the staff member works at.
create policy "staff log visitors at their branches"
  on public.visitors for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and public.jwt_is_staff()
    and public.has_branch_access(branch_id)
  );

create policy "staff update visitors at their branches"
  on public.visitors for update to authenticated
  using (
    public.is_org_member(org_id)
    and public.jwt_is_staff()
    and public.has_branch_access(branch_id)
  )
  with check (
    public.is_org_member(org_id)
    and public.jwt_is_staff()
    and public.has_branch_access(branch_id)
  );

-- Nothing financial hangs off a visitor, so a delete destroys no trail -- but
-- it is still someone else's record of a conversation. Owners only.
create policy "owners delete visitors"
  on public.visitors for delete to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_owner());

-- Conversion ------------------------------------------------------------------
-- Called after `register_member` has already created the member. Kept as an RPC
-- rather than an update from the app because it is the one write that must move
-- three columns together, and the Flutter app will want it too.
create or replace function public.convert_visitor(
  p_visitor_id uuid,
  p_member_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  visitor public.visitors%rowtype;
  member public.members%rowtype;
begin
  select * into visitor from public.visitors where id = p_visitor_id;
  if not found then
    raise exception 'Visitor not found' using errcode = 'no_data_found';
  end if;

  if visitor.status = 'converted'::public.visitor_status then
    raise exception 'That visitor has already been registered as a member'
      using errcode = 'check_violation';
  end if;

  select * into member from public.members where id = p_member_id;
  if not found then
    raise exception 'Member not found' using errcode = 'no_data_found';
  end if;

  if member.org_id <> visitor.org_id then
    raise exception 'That member belongs to another organisation'
      using errcode = 'insufficient_privilege';
  end if;

  update public.visitors
     set status = 'converted'::public.visitor_status,
         converted_member_id = p_member_id,
         converted_at = now()
   where id = p_visitor_id;

  if not found then
    raise exception 'You cannot change a visitor logged at another branch'
      using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'visitor_id', p_visitor_id,
    'member_id', p_member_id
  );
end;
$$;

-- Grants: Supabase hands EXECUTE on every new public function to anon and
-- authenticated by default. The trigger function is internal; only the RPC is
-- callable, and only by a signed-in caller.
revoke all on function public.set_visitor_defaults() from public, anon, authenticated;
revoke all on function public.convert_visitor(uuid, uuid) from public, anon;
grant execute on function public.convert_visitor(uuid, uuid) to authenticated;
