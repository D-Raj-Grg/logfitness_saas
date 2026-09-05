# TASKS — Lord of Gyms

Check this before starting work. Mark tasks `[x]` the moment they are done.
Add newly discovered tasks under the phase they belong to, or under **Discovered**.

Context: `PLANNING.md` (architecture) · `docs/PRD.md` (product).

---

## Phase 0 — Foundation

- [ ] Migration: `orgs`, `branches` tables with `created_at` / `updated_at` triggers
- [ ] Migration: `staff` table (`org_id`, `auth_user_id`, `role`, `branch_ids[]`, `status`)
- [ ] Migration: `audit_log` table + generic audit trigger function
- [ ] Supabase auth hook injecting `{org_id, role, branch_ids[]}` as custom JWT claims
- [ ] RLS policies for `orgs`, `branches`, `staff` reading JWT claims
- [ ] Cross-tenant isolation test suite (org A staff must not read org B rows) — release gate
- [ ] `lib/supabase/{server,client,middleware}.ts` with `@supabase/ssr`
- [ ] Middleware: session refresh + redirect unauthenticated users to `/login`
- [ ] Wire `app/login` to real Supabase email/password auth
- [ ] Staff invite flow: owner invites by email → accept → `staff` row created
- [ ] Replace `app/signup` with org onboarding (create org + owner + first branch)
- [ ] `app/(app)` shell: sidebar, role-aware nav, branch switcher, user menu
- [ ] Generate TypeScript DB types via Supabase MCP; wire into `lib/db`
- [ ] Currency (NPR paisa) and date/time (Asia/Kathmandu) formatting helpers
- [ ] Seed script: demo org, 3 branches, staff across all four roles

## Phase 1 — Member spine

- [ ] Migration: `members` (`phone` unique per org, `auth_user_id` nullable, status enum)
- [ ] Migration: `membership_plans` (`time` | `session_pack`, price in paisa, branch scope)
- [ ] Migration: `memberships` (append-only history, `sessions_remaining`)
- [ ] Migration: `payments` (method enum, `reference_no`, `collected_by`) + `invoices`
- [ ] Trigger: recompute `members.status` from memberships
- [ ] RPC: `renew_membership` — membership + payment + invoice + audit in one transaction
- [ ] RLS + isolation tests for all Phase 1 tables
- [ ] Member list: server-side search by phone/name/ID, pagination, filters, empty state
- [ ] Member registration form (zod-validated Server Action, photo upload)
- [ ] Member profile: memberships, payments, attendance, outstanding dues on one screen
- [ ] Plan catalogue CRUD (owner/manager only)
- [ ] Assign plan / renew / upgrade flow using the RPC
- [ ] Freeze and unfreeze with automatic expiry extension
- [ ] Record payment — full and partial, all methods
- [ ] Refund as a negative payment row with reason
- [ ] Daily collection sheet per branch per staff member
- [ ] Arrears report with age buckets
- [ ] `pg_cron` nightly expiry sweep
- [ ] Dashboards: expiring in 7 days, expired, frozen

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

- [ ] Phone OTP member auth linking to `members.auth_user_id`
- [ ] Member RLS policies (a member reads only their own rows)
- [ ] QR check-in against the Phase 2 token Edge Function
- [ ] Plan status, expiry, and dues screen
- [ ] Payment history
- [ ] Class browsing and self-booking
- [ ] Push notifications via Edge Function fanout
- [ ] iOS App Store and Google Play release pipeline

## Discovered

_Add tasks found mid-work here, dated._

## Open questions (from the PRD)

- [ ] Which SMS/Viber gateway for Nepal, and cost per message at chain volume?
- [ ] Do chains need branch-specific pricing for the same plan?
- [ ] Is the home branch binding for billing, or can any branch collect a renewal?
- [ ] What existing Excel formats must be migrated at onboarding?
- [ ] Nepali-language UI at launch, or English-only for staff?
