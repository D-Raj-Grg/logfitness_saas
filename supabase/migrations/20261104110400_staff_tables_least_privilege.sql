-- The staff card and time tables inherited Supabase's default table grants for
-- signed-in users (insert, update, delete, truncate). Row-level security already
-- stopped the writes that have no policy, but TRUNCATE is not subject to RLS,
-- and a table that cannot be written should not look writable. Grant only what
-- each table's policies actually use.
--
--   staff_cards            select, insert, update   (assign / revoke; never delete)
--   staff_attendance       select                   (only staff_clock_tap writes)
--   staff_attendance_detail select                  (a view)

revoke all on public.staff_cards from authenticated;
grant select, insert, update on public.staff_cards to authenticated;

revoke all on public.staff_attendance from authenticated;
grant select on public.staff_attendance to authenticated;

revoke all on public.staff_attendance_detail from authenticated;
grant select on public.staff_attendance_detail to authenticated;
