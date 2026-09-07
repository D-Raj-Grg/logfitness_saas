# Changelog

What changed in the Lord of Gyms staff console, newest first.

No release has been cut yet, so entries are grouped by the day the work landed
on `main` rather than by version. Each one names the commit, because the commit
messages carry the reasoning and this file only carries the outcome.

Two conventions worth knowing while reading:

- **Security** entries describe holes that existed in this repository's history
  and are now closed. Nothing here shipped to a paying gym; the project has been
  in Phase 0-2 development throughout.
- Anything under **Database** changes the Supabase project. Migrations live in
  `supabase/migrations/` and are applied through the Supabase MCP, so they are
  already live by the time the commit lands.

---

## 2026-09-09 — The reminder that goes out on its own

### Added

- **Notifications**. Renewal reminders at T-7 and T-1, a dues chase, and a
  birthday greeting, worked out once a night and sent over SMS, Viber or email.
  Every number the console already computed — expiring in seven days, arrears
  with age buckets — was a screen somebody had to remember to open. Now it
  leaves on its own.
- **`/notifications`**, the delivery log: what was sent, to whom, why, and what
  the gateway said back, with filters and a resend. The outbox and the log are
  one table, so there is exactly one answer to "was this member told".
- **`/settings/notifications`** (owner only): connect a gateway, choose when
  reminders go out, and edit what they say. The wording editor previews the
  message and counts SMS segments rather than characters, because a Nepali
  reminder is UCS-2 and bills two to three times an English one.
- **A member can say no.** `members.notifications_opt_out`, on the member edit
  form, checked by every sweep. The PRD does not mention consent; sending
  automated SMS with no way to stop is not shippable.
- **Staff invitations are emailed.** Previously an invited person was told, by
  whoever invited them, to go and sign up — nothing was sent. With no email
  gateway configured the message lands as `skipped` and the invite behaves
  exactly as before.

### Database

- Four tables — `notification_providers`, `notification_rules`,
  `notification_templates`, `notification_messages` — all RLS-enabled with
  cross-tenant negative tests, plus `members.notifications_opt_out` and an
  expression index for the birthday sweep. Gate:
  `supabase/tests/notifications.sql`.
- **Sending lives in Postgres**, on `pg_net` and `pg_cron`, not in an Edge
  Function. An Edge Function needs a Supabase project secret, and a project
  secret can only be set from the dashboard or a logged-in CLI — the wall that
  left `qr-token` answering 503 and still leaves `push-fanout`'s FCM path
  unverified. Gateway tokens live per-org in `supabase_vault`, written by an
  owner and readable only by the sender. Nothing is provisioned by hand, which
  is what let the whole path be proven against live HTTPS traffic before it was
  committed: a 200 marked sent, a 500 retried with backoff, a DNS failure
  recorded, a missing gateway skipped rather than failed.
- The gateway abstraction is two pure functions, `notification_request` and
  `notification_response_ok`. Adding a provider is two `case` arms.

### Security

- `get_advisors(security)` caught `resolve_notification_template` shipping as a
  SECURITY DEFINER that took an org id — any signed-in user could have read any
  gym's message wording through `/rest/v1/rpc`. The gate had tested the table's
  RLS and missed the RPC that stepped around it. Fixed to SECURITY INVOKER with
  an explicit org check, and the gate now covers it.
- Two trigger functions were `anon`-callable SECURITY DEFINER functions, a new
  advisory category for this project rather than one of the standing accepted
  ones. EXECUTE revoked.

### Known limits

- The Sparrow, Aakash, Viber and Resend adapters are written from published
  documentation and have never been run against a real account. The
  echo-endpoint test proves the plumbing, not the provider's acceptance.
- Delivery is at-least-once: pg_net's queue and response tables are UNLOGGED,
  so a crash can lose a response and force a retry. A member may, rarely,
  receive the same message twice.

## 2026-09-07 — The chain layer

Phase 3. The console could only ever show one branch at a time; it now shows a
chain, and a manager who runs three branches can finally ask it for their own
total.

### Added

- **One branch scope the whole console reads** (`6dbd2dc`, `992eaf5`). Resolved
  once server-side from a `?branch=` parameter plus a cookie that remembers the
  last choice, so a drill-down is an ordinary link and a link is shareable. The
  switcher sits in the app shell and does not render for a single-branch desk.
- **An HQ dashboard** (`2bd2911`). `org_snapshot` answers for every branch in
  scope in one round trip, where the dashboard used to issue one collection
  query per branch. Every number in the branch table links into the screen that
  already shows that detail -- no new detail pages were built.
- **`/branches`** (`e4b1f0a`), owner-only: list, create, edit, deactivate.
- **Role and branch reassignment** (`fdd3156`), so moving a front-desk hire to
  another branch no longer means deactivating them and starting over.
- **Four chain reports** (`eb31a7a`, `58fb6b4`, `eda875c`): revenue by branch,
  period and method; new members, renewals and churn; the attendance trend; and
  the plan mix.
- **CSV export on all seven report screens** (`37d0835`). The handler re-runs
  the report as the caller through the same cookie-bound client the page used,
  so RLS applies to the file exactly as it applied to the screen, and the file
  is the whole report rather than the page on screen.

### Security

- **A manager could promote someone into a peer manager** (`f40f7a9`). The RLS
  update policy on `staff` restricted a manager only to `role <> 'owner'`, so a
  manager could raise any front desk or trainer they covered to `manager` by
  calling PostgREST directly -- the Flutter app, curl, anything that was not the
  Server Action, which correctly refused it. The invite policy already had the
  right ceiling; the update path never got one. It now lives in
  `guard_staff_assignment()`, alongside guards that the last active owner cannot
  be demoted or deactivated and that nobody changes their own role.
- **`branches` still carried a delete policy** (`e4b1f0a`). Dropped. Nothing in
  the application ever used it.

### Fixed

- **The dashboard lied to multi-branch managers** (`e41c4ac`). Every report
  function took a single branch id, so a manager covering three branches was
  shown the first one with no indication the others were missing. They take
  `p_branch_ids uuid[]` now.
- **Check-in broke for single-branch desks** (`992eaf5`), briefly, during this
  phase: routing the page through the new scope made the write branch null for
  exactly the commonest case, and the desk was told "You do not work at that
  branch" for any member whose home branch differed from theirs.
- **A cross-branch renewal counted as a new member** (`3e2d3f8`), and the member
  who came back at another branch counted as churn. Sequence and churn are facts
  about a member's whole history, not about the branch in view.
- **A cancelled membership was counted on its old end date** (`3e2d3f8`), so a
  year-long plan cancelled in month two surfaced ten months later in a month
  where nothing had happened -- or never.
- **A mistyped date in the URL returned a 500** (`73fbd3f`). `2026-13-01` is
  shaped like a date; Postgres does not roll it over, it raises.

### Database

Six migrations: the branch-list report signatures, `org_snapshot`, the branch
write policies, the staff assignment guard and its manager ceiling, and the four
report functions. Gate: `supabase/tests/chain_layer.sql`.

### Verified

Statically, and against the live database — there is no seeded login on this
machine, so nothing here was clicked through in a browser.

`revenue_report` was reconciled against `daily_collection` on every branch-day
of real data, refund and reversal days included, and `net = gross − refunds −
reversals` held on every row. `org_snapshot`'s totals equal the sum of its
branch rows across all five columns. `attendance_trend` agrees with
`attendance_day_summary`. An empty `uuid[]` means no branches rather than every
branch — the mistake that would quietly show a manager the whole chain. All
twelve functions are `security invoker` bar the one trigger, and `anon` can
execute none of them.

What that leaves untested: the two URL controls composing on screen, the chart,
and the numbers as a person actually reads them.

`npm run db:test` now names all twelve gate files. It named four of nine before,
which is worse than a script that cannot run: it looked like it had passed.

---

## 2026-09-08 — The walk-in who is not a member yet

### Added

- **Visitors** (`008fb45`). A log for everyone who walked in without a
  membership: the enquiry who asked what a month costs, and the guest who
  trained for a day. Name, mobile, the org's own today, branch, kind, one note,
  the plan they asked about, and a status of new / contacted / converted / lost.
  It replaces the paper pad the callback used to die on. Every role can log one,
  trainers included — a walk-in asks whoever is standing there.
- **Register a visitor as a member** (`008fb45`). The row's Register button
  opens the registration form with the name and mobile already filled, and marks
  the visitor converted once the member exists. `converted` is not a status
  anyone can pick: `convert_visitor()` sets it after `register_member()` has
  returned a member, the check constraint refuses it without one, and it cannot
  happen twice.
- **Rows per page on the member and visitor lists** (`008fb45`). 10, 25, 50 or
  100, in the URL like every other filter. `/members` had accepted a `pageSize`
  parameter since it was built with no way to set one.

### Changed

- `Pagination` moved from `components/members/` to `components/app/` and takes a
  `basePath`, because two lists now use it (`008fb45`).
- The visitor list is paged rather than capped. It briefly returned the newest
  200 rows and silently dropped the rest (`008fb45`).

### Fixed

- **A page boundary that moved under the desk** (`4a97afe`). The member list
  sorted by name and the attendance log by check-in time, and neither is unique
  — names repeat, and two people can be checked in at the same instant. Postgres
  guarantees nothing about tied rows across separate `LIMIT`/`OFFSET` queries,
  so a member could appear on page one and page two while another appeared on
  neither, which reads at the desk as a record that has gone missing. Both lists
  now end on `id`, as the visitor list does.
- Following up a visitor logged at another branch (`008fb45`). Reads are
  org-wide but the update policy was not, so a desk could see an out-of-branch
  enquiry, register the member, and then fail to mark the row — silently,
  because the Server Action swallows a failed link rather than throwing away a
  completed registration. Logging stays branch-scoped; following up does not.

### Database

- `visitors`, the `visitor_kind` and `visitor_status` enums, RLS, an audit
  trigger, and `set_visitor_defaults()` filling `visited_on` from
  `org_today(org_id)` and `created_by` from the JWT (`20260908110100`).
- Visitor phone length raised to 32 to match every other phone in the product
  (`20260908110150`).
- Visitor follow-up widened from branch-scoped to org-wide for staff
  (`20260908110200`), and `convert_visitor()`'s refusal message reworded to
  match (`20260908110300`).

### Tests

- `supabase/tests/visitors.sql` (`008fb45`). Branch rules per role, the auto
  date, cross-tenant reads, a member's token reading nothing, and conversion
  happening exactly once. Run through the Supabase MCP, like the rest.

---

## 2026-09-08 — Part of an entry can come back

### Added

- **Take back part of a payment that never arrived** (`47b1678`).
  `reverse_payment()` takes an amount, for the sale rung up at the full price
  when the member handed over less. One negative row for the difference, not a
  full undo plus a fresh payment; the invoice falls to part paid and the balance
  lands on the profile, in the members list and in arrears. Left empty it takes
  the whole entry, which is what it always did. What the invoice still holds is
  the ceiling on any correction, so part reversals cannot be repeated past the
  original entry. Owner and branch manager only, as before.

### Changed

- **The "never received" dialog asks what was actually paid** (`47b1678`), not
  what to take back, and subtracts it itself. Doing that arithmetic at the till
  is how the wrong number gets typed.

---

## 2026-09-07 — Corrections the front desk actually needs

The day's theme is the gap between what the desk records and what happened:
money that never arrived, a plan that starts on Tuesday, a member entered twice.

### Added

- **Archive a member instead of deleting them** (`cbd96a4`). `members.archived_at`
  hides a member from the list, the check-in search, the dashboard tiles and the
  absent-members call list, and changes no membership, invoice or derived status.
  Restore is one click from the new Archived filter. Everything financial still
  counts them — a due is a due whether or not the row is on screen.
- **Owner-only permanent delete** (`cbd96a4`). The RLS policy always refused
  everyone else; the profile now has the door, behind `requireRole('owner')` and
  a typed-name confirmation, because it takes the member's memberships, invoices
  and payments with it.
- **Paid in full / part paid / unpaid at the point of sale** (`d330e54`).
  Registration and renewal ask what actually came in. "Unpaid" unmounts the
  amount and payment-method fields entirely, so nothing false can be submitted;
  the invoice is still raised in full and the due lands on the profile and in
  arrears.
- **A sale can start on a future date** (`d330e54`). `register_member` takes
  `p_start_date` and the membership is created `upcoming` — the member who pays
  on Friday for a batch that begins Sunday.
- **Move the window of a membership already sold** (`f9b3d02`).
  `adjust_membership_dates` extends, corrects, or pushes back a membership.
  Owner or the branch's manager only, reason required, appended to the
  membership notes and recorded in `audit_log`. An expired membership returns to
  active when its new end date is ahead.
- **Reverse a payment that was never received** (`d280d14`). A third
  `payment_kind` beside `payment` and `refund`, for "I'll pay tomorrow" said
  after the sale was rung up. Mechanically a negative row the invoice totals
  follow back into a due, but reported separately so the collection sheet can
  tell money given back from money that never arrived. Owner and branch manager
  only.
- **Preset reasons on every reason box** (`a16bf1c`). Four one-tap chips above a
  textarea that stays visible and stays editable, on reversal, refund, cancel,
  freeze, mark-as-left, archive and date changes.

### Changed

- The old 15-argument `register_member` signature is dropped rather than left
  beside the new one: two overloads differing only by a trailing default make a
  named-argument call from PostgREST ambiguous (`d330e54`).
- `absent_members()` skips archived members. Financial reports deliberately do
  not (`cbd96a4`).
- Receipts print as "Payment correction" for a reversal, and the payments tab
  labels reversals "Never received" rather than lumping them in with refunds
  (`d280d14`).

### Database

- `members.archived_at` / `archived_reason` / `archived_by`, a partial index,
  `archive_member()` and `restore_member()` (`20260907120000`).
- `absent_members()` filters archived rows (`20260907120300`).
- `register_member(p_start_date)` (`20260907120100`).
- `adjust_membership_dates()`, superseding the same day's
  `adjust_membership_end_date()` (`20260907120200`, `20260907120400`).
- `payment_kind` gains `reversal`, `payments_kind_shape` widened, and
  `reverse_payment()` (`20260907120500`, `20260907120600`).

Moving a start date is the one exception to the append-only rule, and
`guard_membership_immutability` remains the enforcement point: it opens for
`start_date` only when `adjust_membership_dates` has set a flag on the
transaction, which a direct PostgREST update cannot do. It is refused once
anyone has checked in against the membership, and while the membership is
frozen. Plan, price, discount, branch and member stay immutable.

### Tests

- `supabase/tests/member_archive_and_dates.sql` and
  `supabase/tests/reverse_payment.sql` (`46b2eb3`). Both run through the
  Supabase MCP rather than psql, so neither is wired into CI yet.

---

## 2026-09-06 — Printed documents, and the gym's own details

### Added

- **A4 invoices and receipts on the org letterhead** (`9a363d8`). An invoice
  existed only as a database row; in a cash-heavy market where partial payment
  is normal, the paper slip *is* the receipt. Printed by the browser's own print
  engine rather than a PDF dependency, so real printers work. Verified at A4
  exactly, on one page.
- **An owner-only Settings screen** (`0b4a1c6`) for the gym's address, phone,
  PAN and logo — the letterhead the printed documents read. `currency` and
  `timezone` are deliberately not editable: changing either retroactively
  reinterprets every amount and timestamp already stored.
- **Print links where the desk is standing** (`287216b`) — after a sale, on the
  invoice row, beside a payment.
- **The joining fee as its own column** (`1e802f3`). `renew_membership` folded it
  into `price_paisa`, so the split existed in no row and a printed invoice could
  not name it as a line. Rows written before this carry 0, meaning "not
  separated" — never guessed back from the plan, which may have been repriced.
- **A public `org-logos` bucket** (`1e802f3`), unlike the private member-photos
  bucket, with owner-only writes. A signed URL adds three ways to print a
  logo-less invoice — an open tab past expiry, a cached render with a dead
  signature, a re-request after it lapsed — and a gym logo is on the shopfront
  already. SVG is excluded: storage serves objects from its own origin, and an
  SVG can carry script.
- **"New" instead of "Expired"** for a member who has never been sold anything
  (`63cc0c8`). The trigger-derived status does not move, because the Active
  tile, arrears and the churn list all depend on it; `member_overview` gains
  `has_membership_history` and only the badge reads it.

### Fixed

- **The inline plan dialog wiped the registration form** (`d2aa66f`).
  `createPlan` revalidated `/members`, which remounted the uncontrolled inputs
  and threw away whatever the desk had half-typed — the exact loss the inline
  dialog exists to prevent. The plan it created also failed to select itself: the
  pending id lived in the effect's dependency array, so clearing it queued a
  second transition that rebased on empty state and overwrote the selection.

---

## 2026-09-05 — The member spine, the front desk, and the mobile backend

### Added

- **Member spine** (`4ad26b5`): members, membership plans, append-only
  memberships, invoices, immutable payments. `members.status` is
  trigger-derived; invoice totals follow payment rows; renew, record payment,
  refund, freeze, unfreeze and cancel are SECURITY INVOKER RPCs so RLS stays the
  boundary. A nightly `pg_cron` sweep expires memberships in the org's own
  timezone.
- **The Phase 1 screens** (`a14a08a`): member list, registration, profile with
  full history, plan catalogue, sell/renew/refund/freeze from the profile, the
  daily collection sheet, arrears with age buckets, dashboard tiles.
- **Member photos** (`12dd74a`) in a private bucket keyed `<org_id>/<member_id>/`,
  read through short-lived signed URLs batched once per page. Plus
  `scripts/smoke.mjs`, which signs in through the API and asserts seeded data
  reaches all 18 Phase 1 routes — the gap `next build` cannot cover.
- **Attendance and check-in** (`77bd4e9`). The verdict lives in Postgres
  (`attendance_banner`, `in_gym_now`), not in the screen, so the Flutter front
  desk gets the same answer as the console. A duplicate same-day check-in is
  refused by a partial unique index and can only be overridden with a stated
  reason.
- **The member principal** (`f4db42d`): invite by email, adopt the row on first
  sign-in, `current_member()`. QR check-in moved out of the Edge Function into
  Postgres, signed with a key that provisions itself in Vault. Class schema with
  self-booking and waitlist promotion; device tokens and a push-fanout function
  (the FCM send path is written but unverified — the service account cannot be
  set from this tooling).
- **Register and sell in one submit** (landed inside `b72192d`, documented in
  `000723a`). One RPC, one transaction: a refused sale registers nobody, so the
  desk corrects one field and submits the same form again.
- **Staff invites** (`7a3ec58`) with branch assignment that mirrors the database
  rule, and a three-branch demo seed.
- **Tenant schema and staff auth** (`66c1591`): orgs, branches, staff,
  `audit_log`, RLS on all four, and an access-token hook that puts
  `{org_id, staff_id, staff_role, branch_ids}` in the JWT so policies read
  claims instead of sub-selecting the staff table on every row.

### Security

- **Members could read the whole gym** (`f4db42d`). Every "staff read X in their
  org" policy tested `is_org_member(org_id)` alone, which was airtight only
  while `org_id` could not appear in a non-staff token. Member tokens carry
  `org_id`, so each of those policies would have handed a member the roster,
  invoices and attendance. They now require `jwt_is_staff()`.
- **Four holes the member-principal audit found** (`b72192d`): the member-photos
  storage policy still tested `is_org_member()` alone, so any member could
  download another's photo; `link_member_account()` trusted an unconfirmed
  email, so signing up with someone else's address adopted their membership;
  push-fanout only branch-scoped the `branch_id` target, so naming `member_ids`
  pushed to the whole chain; `book_class_session` skipped `has_branch_access()`
  on the override path and read a membership row instead of the derived member
  status.
- **A manager could invite a peer manager** (`e96526b`). RLS held — no
  cross-tenant or owner-escalation path existed — but the insert policy was
  wider than the product. Now limited to front desk and trainer, with
  `assignableRoles()` shared by the form and the action.
- **Open redirect on login** (`cd9a8c1`). The `next` parameter was accepted
  whenever it began with a slash, so `//evil.example` resolved off-site.

### Fixed

- **Invited staff signed in to an empty gym** (`66f8d41`). Tenant claims are
  stamped when a token is issued, so adopting a staff row only takes effect
  after a refresh — and that refresh was happening in a Server Component, where
  cookie writes are swallowed. Linking moved to a route handler, and
  `requireStaff` heals sessions already in that state.
- Two colliding migration timestamps renamed, so replay order is defined
  (`000723a`).

### Documentation

- `PLANNING.md` as the architecture contract, `TASKS.md` as the phased backlog,
  `docs/PRD.md` for product context (`40078dd`). Shared-schema multi-tenancy
  isolated by RLS, cash-first billing, staff-only console, integer paisa,
  append-only financial history — with the alternatives that were rejected.
- The scope decision letting the front desk create plans, scoped to branches
  they work at (`000723a`).

---

## 2026-09-04 — Scaffolding

- The shadcn dashboard shell moved to the root route to serve as the index for
  `app.lordofgyms.com`; create-next-app and demo scaffolding stripped; login and
  signup pages added (`48592f9`).
- Initial commit from Create Next App (`8b9a49b`).
