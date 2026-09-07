-- Task 4 (/branches): owner insert/update policies on public.branches already
-- exist (added back in core_rls_policies, before this repo started hand-
-- mirroring migrations), so this migration does not add them.
--
-- What it does fix: an "owners delete branches" policy existed on the table.
-- A branch carries members, cash and attendance, so it must never be
-- deletable -- deactivation is `status = 'inactive'`. Dropping the policy
-- means DELETE falls back to RLS default-deny for every role.
drop policy if exists "owners delete branches" on public.branches;
