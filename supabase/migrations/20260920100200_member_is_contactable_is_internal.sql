-- Follow-up to 20260920100100: `member_is_contactable` was granted to
-- `authenticated` alongside the real RPCs, and it is not one.
--
-- It reads any member row by id, definer-rights and with no tenant check,
-- because the three triggers that call it have already established the org.
-- Callable by a signed-in user it is a boolean oracle over every gym's
-- members: ask it about a uuid and learn whether that member exists, is
-- archived, or has opted out. No client needs it.
revoke execute on function public.member_is_contactable(uuid) from public, anon, authenticated;
