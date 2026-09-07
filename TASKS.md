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
- [x] Member edit screen (`/members/[id]/edit`) — same zod-validated form as
      registration, minus the sale. A manager or the desk keeps the member's
      current home branch selectable even when they could not register into it,
      so an unrelated edit never forces a branch move.
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

- [x] Migration: `attendance` (`method` enum, `checked_out_at` nullable) + RLS + isolation tests (`supabase/tests/front_desk.sql`)
- [x] Check-in screen: fast search, ≤3s to complete (`/check-in`)
- [x] Check-in result banner: active / expiring / expired, and dues outstanding (`attendance_banner` in Postgres, so the Flutter app gets the same verdict)
- [x] Prevent duplicate same-day check-in; allow explicit override (partial unique index + a required reason)
- [x] "In the gym now" live count (`in_gym_now`, with check-out)
- [x] Attendance history on the member profile
- [x] Absent 14+ days report (churn early warning) — `/reports/absent`
- [x] QR token design (mint/verify) — `mint_qr_token` / `verify_qr_token` RPCs, HMAC-signed with a Vault key created on first use; used in Phase 6

## Phase 3 — Chain layer

- [ ] HQ dashboard: active members, today's collection, today's check-ins, expiring — all branches
- [ ] Per-branch drill-down from every HQ metric
- [ ] Branch CRUD (owner only)
- [x] Staff management — invite, role and branch assignment, deactivate/reactivate
      (`/staff`, `inviteStaff` / `setStaffStatus`). Role and branches are set at
      invite time.
- [ ] Edit an *existing* staff row's role or branch list. Not built: the only
      way to change either today is to deactivate and re-invite.
- [ ] Revenue report by branch / period / payment method
- [ ] New members, renewals, and churn per period
- [ ] Attendance trend report
- [ ] Plan mix report
- [ ] CSV export on every report
- [x] `/reports` index page — a thin catalogue so the nav item resolves, listing
      the reports that exist today (absent members, daily collection, arrears).
      Phase 3 fills it out with the chain-layer reports.

## Phase 4 — Classes

- [x] Migration: `classes`, `class_sessions`, `class_bookings` + RLS + isolation tests.
      `pt_sessions` is not part of this migration -- see the unchecked line below.
      Gate: `supabase/tests/classes.sql`.
- [x] Member self-booking RPCs: `book_class_session(p_session_id, p_member_id default null)`
      and `cancel_class_booking(p_booking_id, p_reason default null)`. Capacity
      overflow waitlists instead of failing; cancelling a booked seat promotes
      the oldest waitlisted booking in the same transaction. Both are
      `security definer` (members hold no direct insert/update policy on
      `class_bookings`) with every RLS-equivalent check made by hand inside.
- [ ] `pt_sessions` table (not built -- out of scope for this task; only the
      class/session/booking schema was in scope)
- [ ] `pg_cron` job materializing `class_sessions` 60 days ahead from recurrence rules
- [ ] Class CRUD: trainer, capacity, room, recurrence (Next.js UI; the underlying
      owner/manager write policies on `classes` already exist)
- [ ] Timetable calendar view (dnd-kit for reschedule)
- [ ] Front-desk booking into a session, with waitlist at capacity (Next.js UI;
      the backend RPC it will call -- `book_class_session` with the staff
      `p_member_id` override -- is done)
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

- [x] Member invite flow (email) linking to `members.auth_user_id` — mirrors the
      staff invite flow; phone OTP deferred. DB side (`invite_member`,
      `link_member_account`, `current_member`, claim hook) and the staff-facing
      console UI (`app/(app)/members/actions.ts` `inviteMemberToApp`,
      `components/members/member-app-access.tsx`) are both done. The
      accept/link half of the flow is the Flutter app's job, out of scope here.
- [x] Member RLS policies (a member reads only their own rows) — `20260905150200_member_scope_rls.sql`.
      Also closed the hole the member principal opened: every "staff read X in
      their org" policy tested `is_org_member(org_id)` alone, which stopped
      being staff-only once members carried `org_id`. They now require
      `jwt_is_staff()`. Negative tests in `supabase/tests/member_app.sql`.
- [x] QR check-in — mint/verify live in Postgres (`mint_qr_token`,
      `verify_qr_token`), not an Edge Function, because the project secret one
      would need cannot be set from this tooling. `verify_qr_token` is
      staff-only (`20260905150400`). The Flutter screens that use it are Phase 3
      of the app repo.
- [ ] Plan status, expiry, and dues screen
- [ ] Payment history
- [x] Class browsing and self-booking — backend only: `classes`,
      `class_sessions`, `class_bookings` with RLS, plus `book_class_session`
      (capacity → waitlist) and `cancel_class_booking` (window + waitlist
      promotion). The app screens are Phase 3 of the app repo.
- [ ] Push notifications via Edge Function fanout (substrate done: `device_tokens`
      + RLS, `register_device_token` / `revoke_device_token` RPCs, `push-fanout`
      function deployed. FCM send path itself is unverified -- see Discovered.)
- [ ] iOS App Store and Google Play release pipeline

## Discovered

- [x] **2026-09-05** Adversarial audit of the member-principal work found four
      real defects, all fixed, applied, and covered by regression cases in
      `supabase/tests/`. (1) The `member-photos` storage read policy still
      tested `is_org_member()` alone, so any member could download every other
      member's photo in their gym — the same shape as the table policies fixed
      earlier the same day, missed because it lives in the `storage` schema.
      (2) `link_member_account()` never checked `auth.users.email_confirmed_at`,
      so signing up with a member's email address was enough to adopt their
      record, history and check-ins; a trust decision inside a security-definer
      function must not rest on a dashboard toggle. (3) `push-fanout` enforced
      branch scoping only for the `branch_id` target, so a single-branch front
      desk could push arbitrary content to every member in the chain via
      `member_ids`. (4) `book_class_session` skipped `has_branch_access()` on
      the staff-override path, and read "has an active membership" more loosely
      than the trigger-derived `members.status`, admitting members who had left
      and session packs with nothing left on them.
- [ ] **2026-09-05** Turn on leaked-password protection (Auth → Passwords in the
      dashboard). Flagged by `get_advisors(security)`; it matters more now that
      gym members, not just staff, hold accounts.
- [ ] **2026-09-05** Delete the retired `qr-token` Edge Function. It answers a
      static 410 and holds no secret or data path, so it is litter rather than
      risk, but the MCP has no delete-function tool — do it from the dashboard.
- [ ] **2026-09-05** `push-fanout` caps one call at 500 member ids but has no
      per-org rate limit. Worth adding before the send path is provisioned.
- [x] **2026-09-06** Printed documents and the Settings screen, added outside
      the phase plan at the user's request. A4 invoice and payment receipt on
      the org letterhead, printed through the browser (`@page`/`@media print`)
      rather than a PDF dependency, plus an owner-only `/settings` page that
      supplies the letterhead.
      - Migrations: `20260906120000_org_letterhead.sql` (eight nullable columns
        on `orgs`: `legal_name`, `address`, `phone`, `email`, `pan_no`,
        `tax_note`, `invoice_terms`, `logo_path`; no RLS work needed, "owners
        update their own org" is a table policy),
        `20260906120100_membership_signup_fee.sql`,
        `20260906120200_org_logos_bucket.sql`.
      - **The joining fee had no column.** `renew_membership()` computed
        `subtotal := plan.price_paisa + signup_fee` and wrote that into both
        `memberships.price_paisa` and `invoices.subtotal_paisa`, so the split
        existed nowhere and an invoice could not name it as a line. The RPC now
        also writes `memberships.signup_fee_paisa`. No amount changed. Rows
        written before the migration carry 0, meaning "not separated", not "no
        fee charged" -- they print as one line, and the split must never be
        guessed back from `membership_plans.signup_fee_paisa`, which may have
        been repriced. Gates `member_spine.sql` and `register_member.sql` were
        extended and both re-run green.
      - The `org-logos` bucket is **public**, unlike `member-photos`, with
        owner-only writes. A signed URL expiring inside an open print tab is a
        logo-less invoice, and a gym logo is on the shopfront anyway. SVG is
        excluded (storage serves from its own origin; an SVG can carry script).
      - Print routes live in `app/(print)/`, a sibling of `(app)`, so the
        console shell never renders -- on paper *or* in the on-screen preview,
        which is what lets someone check the sheet before printing. That layout
        calls `requireStaff()` itself; the middleware only proves a session.
      - **`payments` SELECT is branch-scoped**, unlike everything else it joins
        (`is_org_member(org_id) and (jwt_is_owner() or has_branch_access(...))`).
        A manager printing an invoice raised at a branch they do not cover gets
        an empty payments list on a genuinely paid invoice; `invoice.paid_paisa`
        is trigger-maintained and stays right, and the document says so in
        words. Never infer "unpaid" from an empty list.
      - Nothing inside `.doc-a4` uses a theme token or a Base UI component:
        tokens would repaint the sheet if a theme provider is ever added (none
        exists today, so it would ship silently), and portal-backed components
        mount outside the sheet and print as stray content or a blank page.
      - `lib/db/memberships.ts`'s unused `getInvoice` was removed in favour of
        `getInvoiceForPrint` / `getPaymentForPrint` in `lib/db/documents.ts`.
      - Not done: printing the daily collection sheet, and a Branches screen --
        `/branches` and `/classes` are still dead links in `nav-items.ts`.


- [x] **2026-09-05** Classes/sessions/bookings schema and the member
      self-booking RPCs shipped
      (`supabase/migrations/20260905160000_classes_schema.sql`,
      `..._160100_class_booking_rpcs.sql`; gate `supabase/tests/classes.sql`).
      Design notes a reviewer will want:
      - `book_class_session` / `cancel_class_booking` are `security definer`,
        unlike the member-spine RPCs (`renew_membership` etc.), which are
        `security invoker`. The member-spine RPCs work invoker-mode because
        staff hold direct insert/update policies on the tables they write;
        members hold **no** insert/update policy on `class_bookings` at all
        (by design, per this task), so an invoker-mode RPC would have nothing
        to write through. Every RLS-equivalent check (org match, branch match,
        active-membership, double-booking, capacity) is therefore made by hand
        inside the function before any write.
      - "Member's membership is not active" is read from `memberships.status =
        'active'`, not `members.status`; a member can be `expired` at the
        member level but still mid-membership, or vice versa briefly around
        renewal, and the class product cares about the membership.
      - The cancellation window is per-org, read from
        `orgs.settings->>'class_cancellation_window_minutes'`, default 120
        (2 hours) when absent or unparseable. No UI to set it yet -- it is a
        raw jsonb key until Phase 4's admin UI (out of scope here) exposes it.
      - `classes` gets owner/manager insert/update/delete policies (branch-
        scoped, same shape as `membership_plans`) so the schema is not
        write-dead while the Class CRUD UI (still unbuilt) waits. No such
        policies exist on `class_sessions` (materializer's job, later) or on
        `class_bookings` (booking RPCs only, even for staff -- staff pass
        `p_member_id` to `book_class_session` rather than inserting directly).
      - `recurrence` on `classes` is validated jsonb (`day_of_week` 0-6,
        `start_time` < `end_time` per element) via
        `public.validate_class_recurrence()`, shaped for the pg_cron
        materializer that is explicitly a separate, later task -- not built
        here.
      - `class_sessions.capacity` and `.trainer_id` are snapshots taken at
        session-creation time; editing the parent `classes` row afterwards
        does not retroactively change sessions already on the calendar.
      - `class_bookings.booked_count` on the session is trigger-maintained
        (recount, not increment/decrement) by
        `maintain_class_session_booked_count()`; waitlisted rows do not count
        against capacity.
      - `get_advisors(security)` flags `book_class_session` and
        `cancel_class_booking` as "SECURITY DEFINER callable by authenticated"
        -- expected and intentional, the same warning already accepted for
        `link_member_account`, `current_member`, `mint_qr_token`, etc. No new
        advisory category was introduced by this migration.
      - TypeScript types were **not** regenerated: doing so would write under
        `lib/`, which is off-limits while another agent works there. Whoever
        picks up the Class CRUD / timetable UI should run
        `generate_typescript_types` first.
- [x] **2026-09-05** Push notification substrate built and RLS-tested:
      `device_tokens` (one row per device, `member_id` XOR `staff_id`, unique
      `token`, soft `revoked_at`) and `push_log`, both RLS-enabled
      (`supabase/migrations/20260905170000_device_tokens_and_push.sql`).
      `register_device_token` / `revoke_device_token` RPCs (security definer,
      style-matched to `link_member_account`) let the calling principal
      register or soft-revoke only their own token; re-registering a token
      that belonged to someone else re-points it rather than duplicating the
      row. `supabase/tests/push.sql` run end to end via the MCP execute_sql
      throwaway-block loop: a member cannot read another member's device
      token, staff (even an owner) cannot read a member's device token at
      all, a revoked token drops out of the fanout's live-token predicate,
      and re-registering/re-pointing/double-revoking all behave as specced.
      All assertions passed; fixtures torn down afterward.
- [ ] **2026-09-05** `push-fanout` Edge Function deployed
      (`supabase/functions/push-fanout/index.ts`, `verify_jwt: true`) but its
      FCM send path is UNVERIFIED end to end. It authorises the caller with
      the caller's own JWT against an RLS-scoped client calling
      `current_staff()` (never trusts the body's `org_id`/`branch_id`), then
      switches to the service-role key only to resolve device tokens and
      send. It reads a Google service account from the
      `FCM_SERVICE_ACCOUNT_JSON` project secret and returns a 503 with a
      clear message if that secret is unset -- which it currently is, because
      project secrets can only be set from the Supabase dashboard or a
      logged-in CLI, neither available in this environment. So: the
      authorization logic, the request shape, and the DB read/write logic
      have NOT been exercised against live FCM traffic -- only reasoned
      through and reviewed. Set `FCM_SERVICE_ACCOUNT_JSON` from the dashboard
      and re-test with a real device token before relying on this in
      production. This also effectively settles the FCM-vs-OneSignal
      question in `PLANNING.md` §10 in favor of FCM, unless revisited.
- [ ] **2026-09-05** `invite_member`'s own re-invite guard and the
      `members_org_email_key` unique index both surface as Postgres
      `unique_violation` (SQLSTATE 23505) with no distinguishing code, only a
      different message. `inviteMemberToApp` in `app/(app)/members/actions.ts`
      tells them apart by checking the message text ("already has an app
      account" vs. everything else). If the RPC's wording ever changes, this
      mapping has to change with it — consider giving the two failures
      distinct `errcode`s (e.g. a custom domain) in a future migration so the
      console does not have to parse messages.
- [ ] **2026-09-05** The member detail page has no way to show "invited at
      more than one gym" or "no pending invitation" — those are
      `link_member_account()` failures that only happen from the Flutter app
      during sign-in, never from the console. Nothing to build here now, but
      worth remembering if a future admin screen wants to explain *why* a
      member's invite never got accepted (right now the console only shows
      not-invited / invited-on-date / active-since-date, derived from
      `invited_at` / `accepted_at` / `auth_user_id`; it cannot show whether an
      invited member ever attempted to sign in).
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

- [x] **2026-09-05** QR tokens moved out of the Edge Function and into Postgres.
      The function needed a `QR_TOKEN_SECRET` project secret, which the Supabase
      MCP server cannot set — it has no secrets tool — so the path was
      un-provisionable from this project's tooling and sat deployed answering
      503. `public.qr_signing_key()` now creates a 32-byte key in Vault on first
      use, and `mint_qr_token` / `verify_qr_token` sign with it. Nothing to set
      up by hand, on this project or a fresh one.
- [ ] **2026-09-05** Delete the retired `qr-token` Edge Function from the
      dashboard and drop `supabase/functions/`. It is redeployed as a 410 stub
      because the MCP server has no delete-function tool. Nothing calls it.
- [ ] **2026-09-05** `mint_qr_token` and `verify_qr_token` show up in
      `get_advisors(security)` as SECURITY DEFINER functions callable by
      `authenticated`. That is deliberate and unavoidable — they have to read the
      Vault key — so both check authorisation themselves rather than relying on
      RLS, and `supabase/tests/front_desk.sql` asserts it (a trainer cannot mint,
      org B cannot mint or verify against org A, and neither the key nor the
      vault is readable by `authenticated`). Same standing exception as the three
      Phase 0 definer RPCs.
- [ ] **2026-09-05** A session-pack check-in does **not** decrement
      `sessions_remaining`. Phase 4 assigns that to PT sessions, so the front
      door only warns (banner `expiring` at ≤3 sessions, `expired` at 0).
      Revisit if a session pack is ever meant to buy gym-floor entry.
- [ ] **2026-09-05** An open visit is never auto-closed. `in_gym_now` only counts
      visits whose `attended_on` is the gym's today, so a forgotten check-out
      falls off the board overnight instead of inflating it — but the row keeps a
      null `checked_out_at` forever and the duration column reads "In the gym".
      A nightly `pg_cron` close-out would tidy this if the duration data is ever
      wanted for a report.
- [ ] **2026-09-05** `tsconfig.json` now excludes `supabase/functions`: the Deno
      edge runtime has its own globals and `jsr:` imports, which the Next.js
      compiler cannot resolve.

- [x] **2026-09-05** Registration sells a plan in the same submit. New
      `register_member()` RPC: inserts the member, delegates the sale to
      `renew_membership()`, one transaction -- a refused sale registers nobody,
      so the desk corrects one field and submits the same form again. Optional
      collapsed section on `/members/new`, with an inline "+ Add a new plan..."
      dialog. Gate: `supabase/tests/register_member.sql`.
- [x] **2026-09-05** **Scope decision:** the front desk may create plans, scoped
      to a non-empty subset of its own branches (never org-wide). Widened in the
      `membership_plans` insert/update policies, `createPlan`'s `requireRole`,
      and `canScopePlan`. `/plans` and its nav item stay owner/manager, so the
      desk reaches it only through the inline dialog. See PLANNING.md section 4.
- [ ] **2026-09-05** The front desk cannot open `/plans`, so a duplicate plan
      name is refused (23505) without them being able to see the plan they
      collided with. Worth a read-only plan list for the desk, or a friendlier
      message that names the existing plan.
- [ ] **2026-09-05** `members_home_branch_fkey` is `deferrable initially
      deferred`, so registering into a branch from another org is refused at
      COMMIT rather than at the insert. Harmless in the app (each Server Action
      is its own transaction and nothing persists), but a test has to
      `set constraints all immediate` to observe it. Making the composite branch
      FKs immediate would tighten this, if the deferral is no longer needed for
      the reason it was added.
- [ ] **2026-09-05** `register_member` reports which half failed through the
      Postgres `HINT` field, read back as `error.hint` in `mapRegisterError`.
      If another RPC ever needs the same trick, lift it into a shared helper
      rather than re-deriving the convention.

- [x] **2026-09-07** Members can be archived instead of deleted:
      `members.archived_at` / `archived_reason` / `archived_by`, the
      `archive_member` and `restore_member` RPCs, an Archived filter on
      `/members`, and hiding archived rows from the list, the check-in search,
      the dashboard tiles and `absent_members()`. The real delete stays
      owner-only (RLS policy + `requireRole('owner')` + typed-name confirm) and
      cascades the member's financial history away with them.
- [x] **2026-09-07** Registration and renewal ask what was actually paid --
      paid in full / part paid / unpaid -- so a failed QR is not recorded as
      cash. An unpaid sale raises the invoice in full and the due shows on the
      profile.
- [x] **2026-09-07** A sale can start on a future date from the registration
      form (`register_member(p_start_date)`), which lands as an `upcoming`
      membership.
- [x] **2026-09-07** `adjust_membership_dates()` moves the window of a
      membership already sold. Owner or the branch's manager only, reason
      required and appended to the membership notes; an expired membership goes
      back to active when its new end date is ahead. The start date may move
      too -- for the member who pays today and asks to start Tuesday -- but only
      through this RPC, only before any check-in against that membership, and
      never while frozen; the end date shifts with it so the term is preserved.
      `guard_membership_immutability` gates that on a transaction-local GUC the
      RPC sets, so a direct update is still refused. Gate:
      `supabase/tests/member_archive_and_dates.sql`.
- [x] **2026-09-07** `reverse_payment()` corrects a payment that was recorded
      but never received. New `reversal` value on `payment_kind`, widened
      `payments_kind_shape`, reason required, method carried over from the
      original so the drawer line lands on the right column. Owner or the
      branch's manager only. "Not paid" sits beside "Refund" on the member
      profile; the collection sheet labels the line "never received" and the day
      nets to zero. Gate: `supabase/tests/reverse_payment.sql`.
- [x] **2026-09-07** Every reason box (reversal, refund, cancel, freeze notes,
      mark as left, archive, date adjustment) now shows four one-tap chips above
      an always-visible textarea -- `components/forms/reason-field.tsx`. Chips
      fill the box rather than replacing it, and tapping the active chip clears
      it; nothing is hidden behind an "Other" option, because these sentences
      are read back months later during a reconciliation.
- [x] **2026-09-08** `reverse_payment()` takes an amount, so part of an entry
      can come back. The sale rung up at the full price against less in hand is
      one negative row for the difference, not a full undo plus a fresh payment.
      Null keeps the old whole-entry behaviour. What the invoice still holds is
      the ceiling on any correction, so repeated part reversals cannot run past
      the original; a payment with no invoice still goes back whole or not at
      all. The dialog asks what the member actually gave and subtracts it
      itself. Gate: `supabase/tests/reverse_payment.sql`.

- [ ] **2026-09-07** A reversal prints as a "Payment correction" through the
      existing receipt route. Fine as a record, but it is not a receipt -- if
      members are ever handed one, it deserves its own wording rather than a
      relabelled receipt.
- [ ] **2026-09-07** Archiving does not touch the membership, so an archived
      member with a live plan still counts in the collection and arrears
      reports. That is deliberate -- a due is a due -- but if archiving is ever
      used to write off a bad debt, arrears needs its own answer.
- [ ] **2026-09-07** `supabase/tests/member_archive_and_dates.sql` was run
      through the Supabase MCP rather than psql (no CLI login on this machine),
      so it is not wired into any CI step yet. Neither are the older spine
      tests.

- [ ] **2026-09-07** `npm run db:test` runs only four of the nine SQL gates:
      `tenant_isolation`, `member_spine`, `front_desk`, `register_member`.
      `classes.sql`, `member_app.sql`, `push.sql`,
      `member_archive_and_dates.sql` and `reverse_payment.sql` exist and have
      been run by hand through the Supabase MCP, but nothing runs them as a
      set. Add them to the `db:test` script so a regression in the member
      principal, the booking RPCs, the push substrate or the archive/date work
      is caught the same way a member-spine regression is. (Blocked on the same
      missing `psql` / `SUPABASE_DB_URL` noted above, but the script should be
      right regardless.)
- [ ] **2026-09-07** `/payments` carries three screens behind `?view=`
      (register, collection sheet, arrears) and `/reports` links into two of
      them. Fine today; if a fourth view lands, it wants its own route rather
      than another query-string branch.

- [ ] **2026-09-07** `README.md` is still the create-next-app boilerplate. It
      tells a new contributor to edit `app/page.tsx` and nothing about the
      tenancy model, the seed, or the SQL gates. `CHANGELOG.md` now exists and
      should be linked from it once it is rewritten.

## Open questions (from the PRD)

- [ ] Which SMS/Viber gateway for Nepal, and cost per message at chain volume?
- [ ] Do chains need branch-specific pricing for the same plan?
- [ ] Is the home branch binding for billing, or can any branch collect a renewal?
- [ ] What existing Excel formats must be migrated at onboarding?
- [ ] Phone OTP member login — deferred; invite/email is the v1 path
- [ ] Nepali-language UI at launch, or English-only for staff?
