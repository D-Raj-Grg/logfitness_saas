-- Gym schedule + the member's attendance calendar + the renewal-request read.
--
-- 1. Schedule settings (org level, every branch):
--      orgs.settings.weekly_off  int[] of ISO weekdays (1=Mon .. 7=Sun), written
--                                through set_org_setting, stored sorted + deduped.
--      org_holidays              one row per closed date, written through
--                                add_org_holiday / remove_org_holiday.
-- 2. my_attendance_calendar(year, month): the member app's month grid.
-- 3. my_renewal_request(): the member's own pending renewal request, so the app
--    can show "requested -- front desk will call you" after a restart.
--    renewal_requests also joins the supabase_realtime publication so the
--    console can pop a toast when a member asks (staff select RLS still applies).

-- 1a. Holidays -----------------------------------------------------------------
create table public.org_holidays (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  on_date date not null,
  name text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint org_holidays_org_date_key unique (org_id, on_date),
  constraint org_holidays_name_check check (length(btrim(name)) between 1 and 80),
  constraint org_holidays_date_check
    check (on_date between date '2000-01-01' and date '2100-12-31'),
  constraint org_holidays_created_by_fkey
    foreign key (created_by, org_id) references public.staff (id, org_id)
    on delete set null (created_by)
);

comment on table public.org_holidays is
  'Dates the whole gym (every branch) is closed. Written only by add_org_holiday / remove_org_holiday; read by staff and by my_attendance_calendar.';

create trigger org_holidays_set_updated_at
  before update on public.org_holidays
  for each row execute function public.set_updated_at();

create trigger org_holidays_audit
  after insert or delete or update on public.org_holidays
  for each row execute function public.audit_row();

alter table public.org_holidays enable row level security;

create policy "staff read holidays in their org"
  on public.org_holidays for select to authenticated
  using (public.is_org_member(org_id) and public.jwt_is_staff());

revoke insert, update, delete on public.org_holidays from anon, authenticated;

create or replace function public.add_org_holiday(p_on_date date, p_name text)
returns public.org_holidays
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.jwt_org_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_row public.org_holidays%rowtype;
begin
  if v_org is null or public.jwt_staff_role() is null
     or public.jwt_staff_role() not in ('owner'::public.staff_role, 'manager'::public.staff_role)
  then
    raise exception 'Only owners and managers can change gym holidays'
      using errcode = '42501';
  end if;

  if p_on_date is null or p_on_date < date '2000-01-01' or p_on_date > date '2100-12-31' then
    raise exception 'Holiday date must be between 2000 and 2100' using errcode = '22023';
  end if;
  if length(v_name) < 1 or length(v_name) > 80 then
    raise exception 'Holiday name must be 1 to 80 characters' using errcode = '22023';
  end if;

  begin
    insert into public.org_holidays (org_id, on_date, name, created_by)
    values (v_org, p_on_date, v_name, public.jwt_staff_id())
    returning * into v_row;
  exception when unique_violation then
    raise exception 'A holiday is already set for %', p_on_date using errcode = '23505';
  end;

  return v_row;
end;
$$;

create or replace function public.remove_org_holiday(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.jwt_org_id();
begin
  if v_org is null or public.jwt_staff_role() is null
     or public.jwt_staff_role() not in ('owner'::public.staff_role, 'manager'::public.staff_role)
  then
    raise exception 'Only owners and managers can change gym holidays'
      using errcode = '42501';
  end if;

  delete from public.org_holidays h where h.id = p_id and h.org_id = v_org;
  if not found then
    raise exception 'Holiday not found' using errcode = 'no_data_found';
  end if;
end;
$$;

-- 1b. weekly_off in set_org_setting ---------------------------------------------
-- Every existing key and check is reproduced unchanged. weekly_off is the one
-- key a manager may also set (the console's Gym schedule section is
-- owner/manager); every other key stays owner-only.
create or replace function public.set_org_setting(_key text, _value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.jwt_org_id();
  v_int integer;
  v_text text;
  v_days integer[];
  v_result jsonb;
begin
  if v_org is null
     or not (
       public.jwt_is_owner()
       or (_key = 'weekly_off' and public.jwt_staff_role() = 'manager'::public.staff_role)
     )
  then
    raise exception 'Only the owner can change gym preferences'
      using errcode = '42501';
  end if;

  if _key = 'class_cancellation_window_minutes' then
    if _value is null or jsonb_typeof(_value) <> 'number'
       or (_value #>> '{}') !~ '^[0-9]+$' then
      raise exception 'class_cancellation_window_minutes must be a whole number of minutes'
        using errcode = '22023';
    end if;
    v_int := (_value #>> '{}')::integer;
    if v_int < 0 or v_int > 10080 then
      raise exception 'class_cancellation_window_minutes must be between 0 and 10080'
        using errcode = '22023';
    end if;
  elsif _key = 'notification_locale' then
    if _value is null or jsonb_typeof(_value) <> 'string'
       or (_value #>> '{}') not in ('en', 'ne') then
      raise exception 'notification_locale must be "en" or "ne"'
        using errcode = '22023';
    end if;
  elsif _key = 'track_check_out' then
    if _value is null or jsonb_typeof(_value) <> 'boolean' then
      raise exception 'track_check_out must be true or false'
        using errcode = '22023';
    end if;
  elsif _key = 'balance_url' then
    -- null clears it (the console's own page serves). Otherwise an https URL
    -- (or localhost while developing) with no card_no of its own: the QR
    -- appends ?card_no=0004.
    if _value is not null and jsonb_typeof(_value) <> 'null' then
      if jsonb_typeof(_value) <> 'string' then
        raise exception 'balance_url must be a link or null' using errcode = '22023';
      end if;
      v_text := btrim(_value #>> '{}');
      if length(v_text) > 200
         or (v_text !~ '^https://[^\s]+$' and v_text !~ '^http://localhost(:[0-9]+)?(/[^\s]*)?$')
      then
        raise exception 'balance_url must be an https:// link of at most 200 characters'
          using errcode = '22023';
      end if;
      if v_text ~ '[?&]card_no=' then
        raise exception 'balance_url must not carry card_no itself; the card number is added to it'
          using errcode = '22023';
      end if;
      _value := to_jsonb(v_text);
    else
      _value := 'null'::jsonb;
    end if;
  elsif _key = 'weekly_off' then
    -- A JSON array of ISO weekdays, 1 (Monday) to 7 (Sunday). [] means the gym
    -- is open every day. Stored sorted and deduplicated.
    if _value is null or jsonb_typeof(_value) <> 'array' or jsonb_array_length(_value) > 7
       or exists (
         select 1 from jsonb_array_elements(_value) e
         where jsonb_typeof(e) <> 'number' or (e #>> '{}') !~ '^[1-7]$'
       )
    then
      raise exception 'weekly_off must be a list of weekdays, each 1 (Monday) to 7 (Sunday)'
        using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct (e #>> '{}')::integer order by (e #>> '{}')::integer), '{}')
      into v_days
    from jsonb_array_elements(_value) e;
    _value := to_jsonb(v_days);
  else
    raise exception 'Unknown setting: %', _key using errcode = '22023';
  end if;

  update public.orgs
     set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array[_key], _value, true)
   where id = v_org
  returning settings into v_result;

  return v_result;
end;
$$;

-- 2. The member's attendance calendar ---------------------------------------------
-- One call returns every day of the month, already classified, in the gym's own
-- timezone. Precedence per day:
--   present   an attendance row exists with attended_on = that day (even on a
--             weekly-off day or holiday)
--   none      the day is today or later (today with no visit yet is not absent),
--             or falls in a currently-frozen span (frozen_on..today)
--   holiday   an org holiday, inside a membership window
--   off       a weekly_off weekday, inside a membership window
--   absent    inside a membership window, none of the above
--   none      everything else (no membership that day)
-- A membership window is start_date..coalesce(end_date, today) for every
-- membership of the member that is not cancelled. label is the holiday name on
-- any holiday date (present or not), else null.
create or replace function public.my_attendance_calendar(p_year integer, p_month integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member uuid := public.jwt_member_id();
  v_org uuid;
  v_today date;
  v_first date;
  v_last date;
  v_off integer[];
  v_days jsonb;
  v_present integer;
  v_absent integer;
begin
  if v_member is null then
    raise exception 'Members only' using errcode = '42501';
  end if;

  select m.org_id into v_org from public.members m where m.id = v_member;
  if v_org is null then
    raise exception 'Members only' using errcode = '42501';
  end if;

  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'year must be between 2000 and 2100' using errcode = '22023';
  end if;
  if p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'month must be between 1 and 12' using errcode = '22023';
  end if;

  -- Computed here, not via org_today(): the member principal may not read orgs.
  select (now() at time zone coalesce(o.timezone, 'Asia/Kathmandu'))::date,
         coalesce(
           array(
             select (e.v)::integer
             from jsonb_array_elements_text(
               case when jsonb_typeof(o.settings -> 'weekly_off') = 'array'
                    then o.settings -> 'weekly_off' else '[]'::jsonb end
             ) as e (v)
             where e.v ~ '^[1-7]$'
           ),
           '{}'
         )
    into v_today, v_off
  from public.orgs o
  where o.id = v_org;

  v_first := make_date(p_year, p_month, 1);
  v_last := (v_first + interval '1 month' - interval '1 day')::date;

  with day_list as (
    select g::date as d
    from generate_series(v_first::timestamp, v_last::timestamp, interval '1 day') as g
  ),
  windows as (
    select ms.start_date as s, coalesce(ms.end_date, v_today) as e
    from public.memberships ms
    where ms.member_id = v_member and ms.org_id = v_org and ms.status <> 'cancelled'
  ),
  frozen as (
    select ms.frozen_on as s
    from public.memberships ms
    where ms.member_id = v_member and ms.org_id = v_org
      and ms.status = 'frozen' and ms.frozen_on is not null
  ),
  visits as (
    select distinct a.attended_on as d
    from public.attendance a
    where a.member_id = v_member and a.org_id = v_org
      and a.attended_on between v_first and v_last
  ),
  classified as (
    select
      dl.d,
      h.name as holiday_name,
      case
        when exists (select 1 from visits v where v.d = dl.d) then 'present'
        when dl.d >= v_today then 'none'
        when exists (select 1 from frozen f where dl.d >= f.s) then 'none'
        when not exists (select 1 from windows w where dl.d between w.s and w.e) then 'none'
        when h.id is not null then 'holiday'
        when extract(isodow from dl.d)::integer = any (v_off) then 'off'
        else 'absent'
      end as status
    from day_list dl
    left join public.org_holidays h on h.org_id = v_org and h.on_date = dl.d
  )
  select
    jsonb_agg(
      jsonb_build_object('date', c.d, 'status', c.status, 'label', c.holiday_name)
      order by c.d
    ),
    count(*) filter (where c.status = 'present'),
    count(*) filter (where c.status = 'absent')
  into v_days, v_present, v_absent
  from classified c;

  return jsonb_build_object(
    'days', v_days,
    'summary', jsonb_build_object('present', v_present, 'absent', v_absent),
    'today', v_today
  );
end;
$$;

-- 3. The member's own pending renewal request ---------------------------------------
create or replace function public.my_renewal_request()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member uuid := public.jwt_member_id();
  v_row public.renewal_requests%rowtype;
begin
  if v_member is null then
    raise exception 'Members only' using errcode = '42501';
  end if;

  select * into v_row
  from public.renewal_requests r
  where r.member_id = v_member and r.status = 'pending'::public.renewal_request_status;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'status', v_row.status,
    'requested_at', v_row.requested_at,
    'last_requested_at', v_row.last_requested_at,
    'request_count', v_row.request_count
  );
end;
$$;

-- Realtime: the console subscribes to new/updated requests. Row visibility still
-- follows the "staff read renewal requests in their org" policy.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'renewal_requests'
  ) then
    alter publication supabase_realtime add table public.renewal_requests;
  end if;
end $$;

-- Grants -----------------------------------------------------------------------
revoke all on function public.add_org_holiday(date, text) from public, anon;
revoke all on function public.remove_org_holiday(uuid) from public, anon;
revoke all on function public.my_attendance_calendar(integer, integer) from public, anon;
revoke all on function public.my_renewal_request() from public, anon;
revoke all on function public.set_org_setting(text, jsonb) from public, anon;
grant execute on function public.add_org_holiday(date, text) to authenticated;
grant execute on function public.remove_org_holiday(uuid) to authenticated;
grant execute on function public.my_attendance_calendar(integer, integer) to authenticated;
grant execute on function public.my_renewal_request() to authenticated;
grant execute on function public.set_org_setting(text, jsonb) to authenticated;
