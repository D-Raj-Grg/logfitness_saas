# TASKS — Lord of Gyms

Check this before starting work. Mark tasks `[x]` the moment they are done.
Add newly discovered tasks under the phase they belong to, or under **Discovered**.

Context: `PLANNING.md` (architecture) · `docs/PRD.md` (product).

---

## Phase 0 — Foundation

- [x] Migration: `orgs`, `branches` tables with `created_at` / `updated_at` triggers
- [x] Migration: `staff` table (`org_id`, `auth_user_id`, `role`, `branch_ids[]`, `status`)
- [x] Migration: `audit_log` table + generic audit trigger function
- [x] Supabase auth hook injecting `{org_id, role, branch_ids[]}` as custom JWT claims
- [x] RLS policies for `orgs`, `branches`, `staff` reading JWT claims
- [x] Cross-tenant isolation test suite (org A staff must not read org B rows) — release gate
- [x] `lib/supabase/{server,client,proxy}.ts` with `@supabase/ssr`
- [x] Proxy (`proxy.ts`): session refresh + redirect unauthenticated users to `/login`
- [x] Wire `app/login` to real Supabase email/password auth
- [x] Staff invite flow: owner invites by email → accept → `staff` row created
- [x] Replace `app/signup` with org onboarding (create org + owner + first branch)
- [x] `app/(app)` shell: sidebar, role-aware nav, user menu
- [ ] Branch switcher in the app shell header (needs Phase 3 branch scoping)
- [x] Generate TypeScript DB types via Supabase MCP; wire into `lib/db`
- [x] Currency (NPR paisa) and date/time (Asia/Kathmandu) formatting helpers
- [x] Seed script: demo org, 3 branches, staff across all four roles (`supabase/seed.sql`, `npm run db:seed`)

## Phase 1 — Member spine

- [x] Migration: `members` (`phone` unique per org, `auth_user_id` nullable, status enum)
- [x] Migration: `membership_plans` (`time` | `session_pack`, price in paisa, branch scope)
- [x] Migration: `memberships` (append-only history, `sessions_remaining`)
- [x] Migration: `payments` (method enum, `reference_no`, `collected_by`) + `invoices`
- [x] Trigger: recompute `members.status` from memberships
- [x] RPC: `renew_membership` — membership + payment + invoice + audit in one transaction (+ `record_payment`, `refund_payment`, `freeze_membership`, `unfreeze_membership`, `cancel_membership`, `set_member_left`, `reactivate_member`)
- [x] RLS + isolation tests for all Phase 1 tables (`supabase/tests/member_spine.sql`)
- [x] Member list: server-side search by phone/name/ID, pagination, filters, empty state
- [x] Member registration form (zod-validated Server Action, photo upload)
- [x] Member profile: memberships, payments, attendance, outstanding dues on one screen (attendance is a Phase 2 placeholder tab)
- [x] Plan catalogue CRUD (owner/manager only)
- [x] Assign plan / renew / upgrade flow using the RPC
- [x] Freeze and unfreeze with automatic expiry extension (RPC; UI in member action panel)
- [x] Record payment — full and partial, all methods
- [x] Refund as a negative payment row with reason (RPC `refund_payment`; UI in member action panel)
- [x] Daily collection sheet per branch per staff member
- [x] Arrears report with age buckets
- [x] `pg_cron` nightly expiry sweep (`sweep_membership_expiry`, 02:00 Asia/Kathmandu)
- [x] Dashboards: expiring in 7 days, expired, frozen (plus dues and today's collection)

## Phase 2 — Front desk

- [ ] Migration: `attendance` (`method` enum, `checked_out_at` nullable) + RLS + isolation tests
- [ ] Check-in screen: fast search, ≤3s to complete
- [ ] Check-in result banner: active / expiring / expired, and dues outstanding
- [ ] Prevent duplicate same-day check-in; allow explicit override
- [ ] "In the gym now" live count
- [ ] Attendance history on the member profile
- [ ] Absent 14+ days report (churn early warning)
- [ ] QR token design (mint/verify Edge Function) — build now, use in Phase 6

## Phase 3 — Chain layer

- [ ] HQ dashboard: active members, today's collection, today's check-ins, expiring — all branches
- [ ] Per-branch drill-down from every HQ metric
- [ ] Branch CRUD (owner only)
- [ ] Staff management: role and branch assignment, deactivate
- [ ] Revenue report by branch / period / payment method
- [ ] New members, renewals, and churn per period
- [ ] Attendance trend report
- [ ] Plan mix report
- [ ] CSV export on every report

## Phase 4 — Classes

- [ ] Migration: `classes`, `class_sessions`, `class_bookings`, `pt_sessions` + RLS + isolation tests
- [ ] `pg_cron` job materializing `class_sessions` 60 days ahead from recurrence rules
- [ ] Class CRUD: trainer, capacity, room, recurrence
- [ ] Timetable calendar view (dnd-kit for reschedule)
- [ ] Front-desk booking into a session, with waitlist at capacity
- [ ] Trainer marks session attendance
- [ ] PT sessions decrementing `sessions_remaining` on session-pack memberships
- [ ] Trainer utilization report

## Phase 5 — Notifications

- [ ] Choose Nepali SMS/Viber gateway; document cost per message
- [ ] Provider abstraction behind a single interface
- [ ] Per-org editable templates
- [ ] Renewal reminders at T-7 and T-1
- [ ] Dues reminder
- [ ] Birthday greeting
- [ ] Delivery log and failure retry

## Phase 6 — Flutter member app

- [ ] Member invite flow (email) linking to `members.auth_user_id` — mirrors the staff invite flow; phone OTP deferred
- [ ] Member RLS policies (a member reads only their own rows)
- [ ] QR check-in against the Phase 2 token Edge Function
- [ ] Plan status, expiry, and dues screen
- [ ] Payment history
- [ ] Class browsing and self-booking
- [ ] Push notifications via Edge Function fanout
- [ ] iOS App Store and Google Play release pipeline

## Discovered

- [x] **2026-09-05** Access-token hook enabled in the Supabase dashboard and
      verified end to end: signup, onboarding, invite, invite acceptance, and
      role gating all exercised in a browser against a real session.
- [ ] **2026-09-05** Mirror the Phase 0 migrations into `supabase/migrations/`.
      The CLI is installed (2.111.0) but not logged in; run `supabase login`,
      `supabase link`, then `supabase db pull`. Phase 1 migrations are already
      committed there by hand (same SQL that was applied through MCP).
- [ ] **2026-09-05** `psql` is not installed locally, so `npm run db:seed` /
      `db:test` cannot run from this machine yet. Both SQL files were executed
      through the Supabase MCP instead. Install `libpq` (`brew install libpq`)
      and set `SUPABASE_DB_URL`.
- [x] **2026-09-05** Member photo upload: private `member-photos` bucket, RLS on
      `storage.objects` keyed by the `<org_id>/` path prefix, signed-URL reads
      batched per page. Verified: cross-tenant upload and non-image types are
      both refused, and the bucket is not publicly readable.
- [ ] **2026-09-05** Enable leaked-password protection (HaveIBeenPwned) in the
      Supabase Auth dashboard. Flagged by `get_advisors(security)`; it is a
      project setting, not something a migration can turn on.
- [ ] **2026-09-05** `npm run smoke` renders every route as the seeded demo
      owner and asserts the data reaches the page. It needs the dev server
      running and `SMOKE_PASSWORD`. Worth wiring into CI once a hosted preview
      database exists.
- [ ] **2026-09-05** `payments.collected_by` is nullable with `on delete set null`
      so a staff row can be removed without touching cash history; the
      `payments_require_collector` trigger still makes it mandatory on insert.
      Revisit if hard-deleting staff is ever exposed in the UI.
- [ ] **2026-09-05** Branch-specific pricing for the same plan is modelled as
      separate plans scoped by `branch_ids`. If the PRD open question resolves
      to "same plan, different price per branch", add a `plan_prices` table.
- [ ] **2026-09-05** Email delivery for staff invitations. An invited person is
      currently told to sign up with their email address by whoever invited
      them; nothing is sent. Folds into Phase 5 notifications.
- [ ] **2026-09-05** Next.js 16 renamed Middleware to Proxy (`proxy.ts` at the repo
      root, exporting `proxy`). Remember this for any future request interception.

## Open questions (from the PRD)

- [ ] Which SMS/Viber gateway for Nepal, and cost per message at chain volume?
- [ ] Do chains need branch-specific pricing for the same plan?
- [ ] Is the home branch binding for billing, or can any branch collect a renewal?
- [ ] What existing Excel formats must be migrated at onboarding?
- [ ] Phone OTP member login — deferred; invite/email is the v1 path
- [ ] Nepali-language UI at launch, or English-only for staff?
