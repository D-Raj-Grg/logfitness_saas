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
- [x] Branch switcher in the app shell header — `lib/scope.ts` resolves scope once
      server-side from `?branch=` plus an `lg_branch` cookie; the switcher renders
      in the shell only when the caller covers more than one branch.
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

- [x] HQ dashboard: active members, today's collection, today's check-ins, expiring — all branches.
      One `org_snapshot(p_branch_ids uuid[])` RPC returns a row per branch plus a
      totals row, replacing the one-collection-query-per-branch N+1 the dashboard
      used to issue.
- [x] Per-branch drill-down from every HQ metric — every number in the branch
      table links into the screen that already shows that detail, scoped by
      `?branch=`. No new detail pages.
- [x] Branch CRUD (owner only) — `/branches` lists, creates, edits and
      deactivates. **Never deletes:** an `owners delete branches` policy left over
      from the foundation migrations was found still in place and dropped
      (`20260908100200_branch_write_policies.sql`), so the rule is enforced by the
      database rather than by the absence of a button.
- [x] Staff management — invite, role and branch assignment, deactivate/reactivate
      (`/staff`, `inviteStaff` / `setStaffStatus`). Role and branches are set at
      invite time.
- [x] Edit an *existing* staff row's role or branch list — `updateStaffAssignment`
      plus a guard trigger. Closed a real escalation while doing it: the RLS
      update policy restricted a manager only to `role <> 'owner'`, so a manager
      could promote a covered front_desk or trainer into a peer manager by
      calling PostgREST directly, bypassing `assignableRoles`. The ceiling now
      lives in `guard_staff_assignment()`, matching the invite policy's own.
- [x] Revenue report by branch / period / payment method — `/reports/revenue`.
      Refunds and reversals stay in their own columns: a refund says cash left
      the drawer, a reversal says a note that was rung up never arrived, and a
      branch with a problem has a different problem in each case. Reconciled
      against `daily_collection` on real data as a release gate.
- [x] New members, renewals, and churn per period — `/reports/movement`.
      Sequence and churn are read from a member's whole history, not from the
      branch in view: a member who joins at one branch and renews at another is
      a renewal, not a second signup, and is not churn at the branch they left.
      Churn is an expiry with nothing sold after it. A cancelled membership is
      counted on the day it was cancelled, not on the end date it still carries.
- [x] Attendance trend report — `/reports/attendance`, check-ins and the
      distinct members behind them. One member training six times is six
      check-ins and one person still using the gym; the second number is the one
      that says whether the branch is growing.
- [x] Plan mix report — `/reports/plans`. `plan_mix.share_pct` is each row's
      share of every active membership **in scope**, not of its own branch, so
      the screen and the export both recompute the share per branch rather than
      printing a percentage that means something other than its column header.
- [x] CSV export on every report — all seven, including the collection sheet,
      arrears and absent screens. `/api/reports/<report>/csv` re-runs the report
      as the caller through the same cookie-bound client the page used, so RLS
      applies to the file exactly as it applied to the screen, and the file is
      the whole report rather than the page on screen. Cells beginning `=`, `+`,
      `-`, `@`, tab or CR are quoted: these land in Excel.
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
      owner/manager write policies on `classes` already exist). **Restore the
      `Classes` entry in `components/app/nav-items.ts` when `/classes` exists** --
      it was removed on 2026-09-07 because the link 404'd on every prefetch.
- [ ] Timetable calendar view (dnd-kit for reschedule)
- [ ] Front-desk booking into a session, with waitlist at capacity (Next.js UI;
      the backend RPC it will call -- `book_class_session` with the staff
      `p_member_id` override -- is done)
- [ ] Trainer marks session attendance
- [ ] PT sessions decrementing `sessions_remaining` on session-pack memberships
- [ ] Trainer utilization report

## Phase 5 — Notifications

- [x] Choose Custom/Nepali SMS/Viber gateway; document cost per message —
      `docs/notifications.md`. Not one gateway: the choice is a per-org setting,
      because every chain buys its own credits and registers its own sender ID
      with the NTA. Adapters ship for Sparrow SMS, Aakash SMS, Viber Business,
      Resend (email) and a generic `custom_http`. Costs are quoted, not
      contracted, and the Nepali-template multiplier (UCS-2, 70 characters a
      segment) is documented with them.
- [x] Provider abstraction behind a single interface — two **pure** functions,
      `notification_request()` and `notification_response_ok()`. No network and
      no writes, so the gate asserts both against real provider payloads;
      adding a gateway is two `case` arms and an enum value.
- [x] Per-org editable templates — `notification_templates`, keyed by
      (event, channel, locale), English and Nepali built-ins from
      `notification_default_template()` when an org has edited nothing. Wording
      is rendered at **enqueue** time, so editing a template never retroactively
      changes what a member was already told.
- [x] Renewal reminders at T-7 and T-1 — not two events: two
      `notification_rules` rows for one `renewal_reminder` with different
      `offset_days`, so a chain that wants T-3 adds a row.
- [x] Dues reminder — one message per member, not per unpaid invoice, with a
      minimum amount and a cadence guard so chasing is not a daily habit.
- [x] Birthday greeting — from `members.date_of_birth`, which had existed since
      Phase 1 and which nothing had ever read.
- [x] Delivery log and failure retry — `notification_messages` is the outbox
      *and* the log, one table, so there is one answer to "was this member
      told". `/notifications` reads it; retry is 5/25/125 minutes and gives up
      at four attempts.
- [x] Consent, which the PRD does not mention — `members.notifications_opt_out`,
      on the member edit form, checked by every enqueue job. Sending automated
      SMS with no way to stop is not shippable.
- [x] Staff invitations are actually emailed (was a Discovered item folded into
      this phase). With no email gateway configured the message lands as
      `skipped` and the invite behaves exactly as it did before, so this cannot
      regress the existing flow.

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

- [x] **2026-09-11** Printed invoice and receipt redesigned, after INV000031
      printed a self-contradiction: "Joining fee / charged once on the first
      membership" immediately above "Joining fee waived". The fee now shows and
      comes off with a minus, the way a discount reads, with the reason derived
      from whether the membership follows another. Adds a savings banner, a
      black balance-due block, a three-cell meta band (the dead gap under
      "Billed to" is gone), one palette and one type scale, `lib/print/strings.ts`,
      and `app/(preview)/documents` as a dev-only harness for every state.
- [x] **2026-09-11** Discount reason captured at the counter and printed.
      `discount_reason` enum + `discount_note`, both sale RPCs, both forms,
      both zod schemas. Gate: `supabase/tests/discount_reason.sql`.

- [x] **2026-09-10** Waived registration fee now prints. `renew_membership`
      records `memberships.signup_fee_waived_paisa` and `orgs` gained
      `standard_signup_fee_paisa` (owner-editable on `/settings`), so the
      invoice, the receipt, and both counter sale summaries show the fee and
      the same amount taken back off. Money is untouched: the waiver is outside
      the subtotal, and the gate asserts it.
      Gate: `supabase/tests/waived_signup_fee.sql`.

- [x] **2026-09-07** Two render-time faults found by rendering the app as a
      signed-in owner (`npm run smoke`), neither of which `next build` catches:
      - `/check-in` returned 500, "Too many re-renders", from
        `components/attendance/check-in-console.tsx`. `useActionState` was given
        an inline `{}` as its initial state. The streaming server renderer
        returns that initial value on every render pass rather than persisting
        it, so the render-phase `handledState !== state` reset never converged.
        The initial state is now a hoisted module constant.
      - Every app page logged a client error: the sidebar's `Classes` item
        pointed at `/classes`, a route that does not exist, so each prefetch
        404'd and surfaced as React error #441 in the console. The item is
        removed until the Phase 4 UI ships.

- [x] **2026-09-08** Visitor log shipped (`/visitors`): `visitors` table with
      RLS, `set_visitor_defaults` filling the org's today and the author,
      `convert_visitor`, the sidebar entry for every role, the log/filters/table
      UI, and prefilled registration from a visitor row. Scope decision recorded
      in `PLANNING.md` section 4; gate is `supabase/tests/visitors.sql`.
- [x] **2026-09-08** Review of the above caught a branch-scoping bug: the read
      is org-wide but the update policy was not, so a desk that could see an
      enquiry logged at another branch registered the member and then failed to
      mark the row -- silently, because the Server Action swallows a failed
      link. Follow-up is now org-wide for staff
      (`20260908110200_visitors_follow_up_is_org_wide.sql`); logging stays
      branch-scoped. Covered by two new cases in the gate.
- [x] **2026-09-08** Visitor list paginated with a rows-per-page control
      (10/25/50/100). `Pagination` moved from `components/members/` to
      `components/app/` and takes a `basePath`; the new `PageSizeSelect` puts
      the size in the URL and resets to page one. `/members` gains the same
      control -- its query already accepted `pageSize` with no way to set it.
      Sort carries `id` as a final tiebreak: rows written in one transaction
      share `created_at`, and without a unique last sort key a row can appear on
      two pages and another on none.
- [x] **2026-09-08** Same tiebreak defect fixed in the two lists that already
      paged: `listMembers` sorted by `full_name` alone (names repeat -- and a
      duplicate entry is the very thing archiving exists for) and
      `listAttendance` by `checked_in_at` alone (two people can be checked in at
      the same instant). Both now end on `id`. Verified against 24 members
      sharing three names and 24 check-ins sharing one timestamp: three pages,
      every row exactly once.
- [x] **2026-09-07** `/members`, `/visitors`, and every other paged list threw
      at runtime: "Attempted to call DEFAULT_PAGE_SIZE() from the server but
      DEFAULT_PAGE_SIZE is on the client". `lib/validation/pagination.ts` read
      `PAGE_SIZES`/`DEFAULT_PAGE_SIZE` from `components/app/page-size-select`,
      a `'use client'` module, so the server got a client reference rather than
      the number. The constants now live in `lib/pagination.ts` and both the
      control and the schemas import them from there. `next build` does not
      catch this -- the boundary only fails when the page actually renders.

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
- [x] **2026-09-05** Email delivery for staff invitations. Done in Phase 5:
      `inviteStaff` enqueues a `staff_invite` email and reads the message's
      status back, so it only claims an email is on its way when one actually
      is. An org with no email gateway gets a `skipped` row and the old
      behaviour.
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

- [ ] **2026-09-07** Nothing in the codebase reads `branches.status`. A branch
      deactivated on `/branches` still appears in the registration branch picker
      and in staff assignment — deactivating changes what the branch list says
      and nothing else. Deliberately left out of the Branch CRUD task rather
      than smuggled into it; it needs its own pass over every place a branch is
      offered for selection.
- [ ] **2026-09-07** Migration filenames do not match the versions Supabase
      recorded, for all 58 of them — `member_archive` is `20260907044352` on the
      remote and `20260907120000` in git. The names match; only the numeric
      prefix differs, because `apply_migration` assigns its own timestamp while
      the mirrored file is named by hand. Harmless until someone logs the CLI in
      and runs `supabase migration repair`, which will have to reconcile the lot.
- [ ] **2026-09-07** Three remote migrations have no file in git, beyond the
      known Phase 0 gap: `renew_membership_casts_status_enum` (20260905032657),
      `sync_invoice_totals_casts_status_enum` (20260905032812) and
      `register_member_error_hints` (20260905172322). A project rebuilt from git
      alone would miss three fixes.

- [ ] **2026-09-07** `npm run db:test` now names all twelve gate files, but it
      still cannot run from this machine — `psql` is not installed and the
      Supabase CLI is not logged in. Every Phase 3 gate was run through the
      Supabase MCP with the throwaway-function loop instead. Wiring this into CI
      needs a hosted preview database.
- [ ] **2026-09-07** The chain reports have no UI regression coverage. The SQL
      is gated in `chain_layer.sql`, but nothing exercises the screens: the two
      URL controls composing, an invalid date falling back, the per-branch share
      being recomputed. `scripts/smoke.mjs` renders routes as the seeded owner
      and would be the place for it, once a login is reachable from CI.

- [x] **2026-09-09** Phase 5 notifications shipped. Design notes a reviewer will
      want:
      - **Sending is Postgres, not an Edge Function.** `pg_net` for the request,
        `pg_cron` for the schedule, gateway tokens in `supabase_vault` per org.
        The reason is the same wall `qr-token` and `push-fanout` hit: a Supabase
        project secret can only be set from the dashboard or a logged-in CLI,
        and this project's tooling has neither. Nothing here needs provisioning
        by hand, which is what let the send path be proven end to end -- the
        thing `push-fanout` still has not been.
      - **Proven against live traffic** before commit, through a throwaway org
        pointed at an HTTPS echo endpoint: request shaping and TLS, pg_net
        dispatch, the reaper, a 200 marked `sent`, a 500 retried with backoff, a
        DNS failure recorded as `Couldn't resolve host name`, and a channel with
        no gateway marked `skipped`. Fixtures torn down.
      - **`net.http_post` cannot send form-encoded bodies.** pg_net 0.20 raises
        unless Content-Type is exactly `application/json`. Sparrow and Aakash
        both document GET as equivalent, so those go out as `net.http_get` with
        `params`. There is no PUT or PATCH at all -- a gateway that requires one
        cannot ship this way.
      - **Delivery is at-least-once.** `net.http_request_queue` and
        `net._http_response` are UNLOGGED, so a crash, compute resize or
        Postgres upgrade truncates both. A row stuck `sending` for ten minutes
        with no response is retried, which means a member can rarely receive the
        same message twice. Never retrying would silently drop reminders, which
        is worse, but this is a product fact worth someone signing off on.
      - **`skipped` is not `failed`.** No gateway, no token, an opted-out member
        or an undeliverable number all produce `skipped`, which is not retried
        and is not shown in red. An org with no gateway is skipped at enqueue
        time entirely rather than accumulating a row per member per day.
      - Phone numbers are normalised at enqueue time into the message's own
        `to_address`, never in `members.phone`: that column is free text under
        `unique (org_id, phone)`, so normalising in place could collide two real
        members.
      - Gate: `supabase/tests/notifications.sql`, run through the Supabase MCP
        (no `psql` on this machine). Docs: `docs/notifications.md`.
- [ ] **2026-09-09** **The Sparrow, Aakash, Viber and Resend adapters have never
      been exercised against a real account.** The echo-endpoint test proves the
      plumbing and the request shaping, not that any provider accepts the
      payload. Each one is written from published documentation. Connect an
      account and use the **Send test** button on `/settings/notifications`
      before relying on it, and tick this off per provider.
- [ ] **2026-09-09** `pg_net`'s install script grants schema, table, sequence and
      function access to `PUBLIC`, so `anon` and `authenticated` hold EXECUTE on
      `net.http_post` and write access to `net.http_request_queue` -- an
      outbound-HTTP primitive. The migration's REVOKEs are **no-ops**: schema
      `net` and every object in it is owned by `supabase_admin`, and `postgres`
      (which is what a migration and the dashboard SQL editor both run as) has
      no grant option. What actually keeps this closed is that `net` is not one
      of PostgREST's exposed schemas, so no API caller can reach it. Worth a
      support ticket, or at least a note before anyone adds `net` to the exposed
      schema list. Gateway tokens also sit in `net.http_request_queue.url` for
      up to the pg_net TTL (six hours here).
- [x] **2026-09-09** `get_advisors(security)` found two real holes in the Phase 5
      work, both fixed in `20260909140700_notification_definer_surface.sql` and
      both now covered by the gate. (1) `resolve_notification_template` was
      SECURITY DEFINER and took an org id, so any signed-in user could read any
      gym's message wording through `/rest/v1/rpc` -- the gate had tested the
      table's RLS and missed the RPC that stepped around it. It is SECURITY
      INVOKER with an explicit org check now. (2) The two trigger functions
      (`drop_notification_secret`, `seed_notification_rules_for_new_org`) were
      `anon`-callable definer functions, a new advisory category for this project
      rather than one of the standing 0029 exceptions; EXECUTE revoked.
- [x] **2026-09-09** The advisor fix above then broke the product, which is
      worth recording because it is the more instructive half. Making
      `resolve_notification_template` SECURITY INVOKER with an
      `is_org_member(p_org_id)` guard closed the leak and stopped every nightly
      sweep: the three enqueue jobs call it, pg_cron holds no JWT claims, the
      guard was false for every org, the lateral join produced no row, and
      `enqueue_renewal_reminders()` returned 0 for a gym with a member expiring
      in seven days. Nothing errored. Reminders would simply have stopped, which
      is the worst way this feature can fail. Caught by re-running the sweep the
      way cron runs it -- with no claims at all -- rather than the way the gate
      had been running it. Fixed in
      `20260909140800_notification_template_resolution_split.sql` by splitting
      the two callers: `resolve_notification_template` stays definer and is
      callable by no client role (the sweeps), and
      `notification_template_preview` is invoker and org-guarded (the console).
      The gate now runs the sweep with claims cleared, so this cannot come back.
- [ ] **2026-09-09** Phase 5 has **not** been walked in a browser. The routes
      mount and redirect correctly (`/notifications` and
      `/settings/notifications` both 307 to `/login`), the build is clean and the
      SQL gate is green, but no environment variable on this machine carries a
      password for the seeded owner, so nobody has actually connected a gateway,
      edited wording or clicked Send test through the UI. Do that before calling
      the screens finished.
- [x] **2026-09-09** Post-implementation review of the Phase 5 work (no browser;
      migration files diffed against the live database, then the logic probed
      case by case). Two more real defects, both fixed in
      `20260909140900_dues_reminders_do_not_repeat_for_a_skipped_member.sql` and
      both now in the gate:
      - **The dues sweep wrote a row a night, for ever, for any member with an
        outstanding balance and a phone number that will not normalise.** The
        cadence guard counted only `queued`/`sending`/`sent`, and the dedupe key
        carries the date, so a `skipped` row suppressed nothing. Verified two
        rows after two simulated nights with no reason to stop -- the exact row
        explosion the design claims to prevent at the org level, missed one
        level down at the member. `skipped` now counts, and the gate simulates
        the next night.
      - Every SMS carried `subject = ''` rather than null, because a subject
        rendered from a null template returned the empty string. Invisible
        today; the first `coalesce(subject, ...)` on the email path would have
        chosen '' over its own fallback. Fixed centrally in
        `render_notification_template`.
      Two app-side defects fixed at the same time: the delivery log's summary
      strip fetched **every** message row to count four numbers (now four
      `head: true` counts), and the settings form picked the first gateway row
      for a channel rather than the active one.
      Also checked and found sound: all 28 function bodies in
      `supabase/migrations/2026090914*.sql` match the live database
      byte-for-byte once whitespace is normalised; every table, policy, index,
      trigger and constraint the schema migration declares exists; an empty
      branch list produces a valid PostgREST filter rather than a parse error;
      and a trainer reading a dues reminder leaks nothing, because trainers can
      already read `invoices` directly.
- [x] **2026-09-09** An automated review of the Phase 5 commit flagged the retry
      and cancel Server Actions as gating on `requireStaff()` while the UI shows
      them to owners and managers only. Not exploitable -- verified against the
      live database that a front desk, a trainer and a manager of another branch
      are each refused `42501` by `retry_notification`, and the gate already
      asserts the desk case. But it pointed at a worse defect beside it: both
      actions swallowed the refusal, so a manager resending a message raised at
      a branch they do not cover saw nothing happen, which is indistinguishable
      from success. Both now gate on `requireRole('owner', 'manager')` -- the
      database stays the boundary, the app states the rule, as every other
      action here does -- and the row actions moved into a client component that
      reports the outcome through a toast instead of discarding it.
- [ ] **2026-09-09** `notification_messages` answers an unauthenticated request
      with `401 permission denied for function jwt_member_id`, where
      `device_tokens` and `members` answer `200 []` -- despite carrying a
      byte-identical member policy. No data is exposed and no real caller is
      affected (`authenticated` holds EXECUTE on all three `jwt_*` helpers, so
      the console and the Flutter app are unaffected), but it is an
      inconsistent error surface that names an internal function to `anon`.
      Worth understanding before the member app ships.
- [ ] **2026-09-09** A 29 February birthday never fires in a non-leap year --
      `enqueue_birthday_greetings` matches month and day exactly. Deliberate
      rather than guessing at 28 February or 1 March, but if a gym ever asks, the
      decision is theirs to make.
- [ ] **2026-09-09** Notification configuration changes are not written to
      `audit_log`. `CLAUDE.md` scopes auditing to members, memberships, payments
      and plans, and the repository still has **no audit-writing helper at all**
      -- `audit_log` is a declared-but-unwired table. Building the first one is
      its own task; changing who receives what, and what it says, is a
      reasonable second candidate for it.
- [ ] **2026-09-09** A rule whose `send_at_local` is earlier than 02:30
      Kathmandu goes out the following morning, because the nightly enqueue runs
      at 02:30 (just after `sweep-membership-expiry`, so membership statuses are
      already recomputed). The settings screen says so; nobody has asked for an
      earlier send yet.
- [ ] **2026-09-09** There is no per-org send cap or spend alert. A misconfigured
      rule on a 50-branch chain is a real bill. The same gap is already recorded
      for `push-fanout`'s missing rate limit; both want one answer.

- [ ] **2026-09-07** Phase 3 was verified statically, never in a browser — no
      seeded login is reachable from this machine. What *was* checked, live
      against the database: `revenue_report` reconciles with `daily_collection`
      on every branch-day of real data, refund and reversal days included;
      `org_snapshot` totals equal the sum of its branch rows; `attendance_trend`
      agrees with `attendance_day_summary`; an empty `uuid[]` means no branches
      rather than all of them; every CSV column key resolves to a key the row
      mapper produces; and `resolvePeriod` rejects `2026-02-29` while keeping
      `2024-02-29`. What was **not** checked: the branch and period controls
      composing on screen, the chart rendering, and the numbers as a person
      reads them. Those want `scripts/smoke.mjs` and a login.
- [ ] **2026-09-07** Two Phase 3 commits never had a task-level review —
      `73fbd3f` (the invalid-date fix) and `37d0835` (CSV export). The subagents
      that owned them were killed mid-task by a session rate limit and the work
      was finished by hand. The static verification above stands in for that
      review; a whole-branch review has still not run over them.

- [ ] **2026-09-09** The Flutter app is now being built to full staff parity
      with this console, which makes a set of RPC signatures a **published
      contract with a second consumer** rather than an internal detail. The
      mobile staff app calls `register_member`, `convert_visitor`,
      `renew_membership`, `record_payment`, `refund_payment`, `reverse_payment`,
      `freeze_membership`, `unfreeze_membership`, `cancel_membership`,
      `set_member_left`, `reactivate_member`, `adjust_membership_dates`,
      `archive_member`, `restore_member`, `invite_member`, `daily_collection`
      and `arrears_report`. Changing an argument list or a returned shape on any
      of these now breaks a shipped app that updates on the store's schedule,
      not on deploy. `register_member` has already been re-declared once
      (`20260907120100_register_member_start_date.sql` added `p_start_date`);
      adding an argument with a default is safe, reordering or renaming is not.
      Worth deciding whether these get a versioning rule before the app ships.

- [ ] **2026-09-11** A member registered through `register_member` always
      starts **opted in** to automated messages, on both surfaces, and nothing
      at the point of registration can change it. `members.notifications_opt_out`
      exists and every enqueue job checks it, but the RPC has no
      `p_notifications_opt_out` argument, and `components/members/member-form.tsx`
      renders the consent checkbox inside a `{member ? ...}` branch — so it is
      shown when editing and not when registering. The Flutter app matches this
      exactly, deliberately, rather than diverging.
      Consent is the one setting where defaulting quietly is least defensible:
      `docs/notifications.md` treats opt-out as a shipping requirement, and a
      member who says "do not text me" while signing up currently has to be
      edited afterwards for it to take. Adding the argument with a `default
      false` is backwards-compatible for both callers (and the mobile app is
      now a second consumer of this signature — see the note above).

- [x] **2026-09-11** Member list usability pass: a serial-number column that
      carries across pages, sortable Code / Name / Plan / Dues headers with the
      entry feed (newest member code first) as the default order instead of
      A-Z, and a per-row action menu with a quick-edit dialog for the four
      fields the list shows. The membership forms in that menu are links to the
      profile with `?action=renew|pay|freeze|unfreeze` rather than dialogs on
      the row: they need the member's memberships, invoices, payments and the
      branch's plans, which the profile already loads and a list row would have
      to fetch twenty-five times over.

## Open questions (from the PRD)

- [x] Which SMS/Viber gateway for Nepal, and cost per message at chain volume?
      Answered as a per-org setting rather than one choice, with adapters for
      Sparrow, Aakash, Viber and any HTTP gateway. Costs in `docs/notifications.md`,
      quoted rather than contracted.
- [ ] Do chains need branch-specific pricing for the same plan?
- [ ] Is the home branch binding for billing, or can any branch collect a renewal?
- [ ] What existing Excel formats must be migrated at onboarding?
- [ ] Phone OTP member login — deferred; invite/email is the v1 path
- [ ] Nepali-language UI at launch, or English-only for staff?
