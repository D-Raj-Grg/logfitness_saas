-- staff_attendance_summary counted a forgotten, auto-closed shift as "open"
-- (both have no clock-out time). A person with one live shift and one old
-- forgotten one showed two open shifts. Open now means open; forgotten shifts
-- get their own column. Return type changes, so drop and recreate.

drop function if exists public.staff_attendance_summary(uuid, date, date);

create function public.staff_attendance_summary(
  p_staff_id uuid,
  p_from date default null,
  p_to date default null
)
returns table (
  last_clock_in_at timestamptz,
  last_attended_on date,
  on_shift boolean,
  lifetime_days bigint,
  days_in_range bigint,
  minutes_in_range bigint,
  open_shifts_in_range bigint,
  forgotten_shifts_in_range bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    max(sa.clocked_in_at),
    max(sa.attended_on),
    coalesce(bool_or(sa.clocked_out_at is null and not sa.auto_closed), false),
    count(distinct sa.attended_on)::bigint,
    count(distinct sa.attended_on) filter (
      where (p_from is null or sa.attended_on >= p_from)
        and (p_to is null or sa.attended_on <= p_to)
    )::bigint,
    -- Closed shifts only: an open or forgotten one has no end to measure to.
    coalesce(sum(
      extract(epoch from (sa.clocked_out_at - sa.clocked_in_at)) / 60
    ) filter (
      where sa.clocked_out_at is not null
        and (p_from is null or sa.attended_on >= p_from)
        and (p_to is null or sa.attended_on <= p_to)
    ), 0)::bigint,
    count(*) filter (
      where sa.clocked_out_at is null and not sa.auto_closed
        and (p_from is null or sa.attended_on >= p_from)
        and (p_to is null or sa.attended_on <= p_to)
    )::bigint,
    count(*) filter (
      where sa.auto_closed
        and (p_from is null or sa.attended_on >= p_from)
        and (p_to is null or sa.attended_on <= p_to)
    )::bigint
  from public.staff_attendance sa
  where sa.staff_id = p_staff_id;
$$;

revoke execute on function public.staff_attendance_summary(uuid, date, date) from public, anon;
grant execute on function public.staff_attendance_summary(uuid, date, date) to authenticated;
