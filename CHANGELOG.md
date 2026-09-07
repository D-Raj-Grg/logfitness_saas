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
