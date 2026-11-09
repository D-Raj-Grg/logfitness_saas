-- Supabase default privileges give anon table grants; org_holidays is staff-only
-- (RLS has no anon policy, but the grant itself should not exist either).
revoke all on public.org_holidays from anon;
