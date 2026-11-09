-- Renewal requests. A member on the public balance page taps "Request
-- renewal"; the desk sees it, calls them, and renews at the counter as always.
-- No payment happens online -- this is a note on the counter, not a sale.
--
-- One pending request per member: asking again bumps request_count and
-- last_requested_at on the same row instead of stacking rows. Renewing the
-- member (any new memberships row) closes the pending request by itself, so
-- the desk never has to remember to tick it off; "Reject" exists for the rest.
--
-- Rows are written only by public_renewal_request (next migration, service
-- role) and handle_renewal_request / the memberships trigger here. Staff read
-- their org's rows.

create type public.renewal_request_status as enum ('pending', 'done', 'rejected');

create table public.renewal_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  member_id uuid not null,
  card_stock_id uuid,
  phone text,
  note text,
  status public.renewal_request_status not null default 'pending',
  request_count integer not null default 1,
  requested_at timestamptz not null default now(),
  last_requested_at timestamptz not null default now(),
  handled_by uuid,
  handled_at timestamptz,
  handled_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint renewal_requests_phone_check check (phone is null or length(phone) <= 20),
  constraint renewal_requests_note_check check (note is null or length(note) <= 500),
  constraint renewal_requests_handled_note_check
    check (handled_note is null or length(handled_note) <= 500),
  constraint renewal_requests_count_check check (request_count >= 1),
  constraint renewal_requests_handled_check
    check ((status = 'pending'::public.renewal_request_status) = (handled_at is null)),
  constraint renewal_requests_member_fkey
    foreign key (member_id, org_id) references public.members (id, org_id)
    on delete cascade,
  constraint renewal_requests_card_stock_fkey
    foreign key (card_stock_id, org_id) references public.card_stock (id, org_id)
    on delete set null (card_stock_id),
  constraint renewal_requests_handled_by_fkey
    foreign key (handled_by, org_id) references public.staff (id, org_id)
    on delete set null (handled_by)
);

create unique index renewal_requests_one_pending_key
  on public.renewal_requests (member_id)
  where status = 'pending'::public.renewal_request_status;

create index renewal_requests_org_status_idx
  on public.renewal_requests (org_id, status, last_requested_at desc);

comment on table public.renewal_requests is
  'A member asked to renew from the public balance page. One pending row per member; renewing them closes it. Written only by public_renewal_request, handle_renewal_request and the memberships trigger.';

create trigger renewal_requests_set_updated_at
  before update on public.renewal_requests
  for each row execute function public.set_updated_at();

create trigger renewal_requests_audit
  after insert or delete or update on public.renewal_requests
  for each row execute function public.audit_row();

-- Done or rejected, by the desk. Once.
create or replace function public.handle_renewal_request(
  p_request_id uuid,
  p_status public.renewal_request_status,
  p_note text default null
)
returns public.renewal_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := public.jwt_org_id();
  v_staff_id uuid := public.jwt_staff_id();
  v_row public.renewal_requests%rowtype;
begin
  if v_org_id is null or v_staff_id is null or not public.jwt_can_serve_members() then
    raise exception 'Only front desk, managers and owners can handle renewal requests'
      using errcode = 'insufficient_privilege';
  end if;

  if p_status = 'pending'::public.renewal_request_status then
    raise exception 'A request is closed as done or rejected'
      using errcode = 'check_violation';
  end if;

  select * into v_row
  from public.renewal_requests r
  where r.id = p_request_id and r.org_id = v_org_id
  for update;
  if not found then
    raise exception 'Renewal request not found' using errcode = 'no_data_found';
  end if;

  if v_row.status <> 'pending'::public.renewal_request_status then
    raise exception 'This request was already %', v_row.status
      using errcode = 'check_violation';
  end if;

  update public.renewal_requests r
  set status = p_status,
      handled_by = v_staff_id,
      handled_at = now(),
      handled_note = nullif(btrim(coalesce(p_note, '')), '')
  where r.id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

-- A new memberships row for a member is the renewal the request asked for.
-- Security definer: the desk user inserting the membership has no update
-- privilege on renewal_requests, and should not need one.
create or replace function public.close_renewal_requests_on_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.renewal_requests r
  set status = 'done'::public.renewal_request_status,
      handled_by = coalesce(new.sold_by, public.jwt_staff_id()),
      handled_at = now(),
      handled_note = 'Renewed at the desk'
  where r.member_id = new.member_id
    and r.status = 'pending'::public.renewal_request_status;

  return new;
end;
$$;

create trigger memberships_close_renewal_requests
  after insert on public.memberships
  for each row execute function public.close_renewal_requests_on_membership();

-- RLS ------------------------------------------------------------------------
alter table public.renewal_requests enable row level security;

create policy "staff read renewal requests in their org"
  on public.renewal_requests for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

-- No write policies and no write privilege: writes go through the RPCs.
revoke insert, update, delete on public.renewal_requests from anon, authenticated;

-- Grants -----------------------------------------------------------------------
revoke execute on function public.close_renewal_requests_on_membership() from public, anon, authenticated;
revoke execute on function public.handle_renewal_request(uuid, public.renewal_request_status, text) from public, anon;
grant execute on function public.handle_renewal_request(uuid, public.renewal_request_status, text) to authenticated;
