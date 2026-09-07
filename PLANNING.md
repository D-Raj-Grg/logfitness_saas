# PLANNING — Lord of Gyms

Read this at the start of every session. It is the architectural contract.
Full product context: `docs/PRD.md`. Work queue: `TASKS.md`.

---

## 1. What this is

Multi-branch gym management SaaS for gym chains in Nepal / South Asia.
Web console is **staff-only**. Members are records, not users, until the Flutter app phase.

- Staff console: https://app.lordofgyms.com
- Marketing site: https://lordofgyms.com (separate Vercel project)

Target customer: chains with 3–50 branches. Cash-heavy market — billing means
*recording and chasing* payments, not charging cards.

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 App Router | **Breaking changes vs. training data — read `node_modules/next/dist/docs/` before writing Next code.** See `AGENTS.md`. |
| React | 19.2 | Server Components by default; `"use client"` only when a component needs state, effects, or browser APIs |
| DB / Auth | Supabase (Postgres + Auth + RLS) | Access via MCP tools; `apply_migration` for schema, never ad-hoc `execute_sql` for DDL |
| SSR auth | `@supabase/ssr` | Cookie-based sessions; never use the browser client in a Server Component |
| UI | shadcn/ui + Tailwind v4 + Base UI | Add components with the shadcn CLI/MCP, do not hand-copy |
| Tables | `@tanstack/react-table` | For every list view |
| Charts | recharts | Dashboards and reports |
| DnD | `@dnd-kit/*` | Class timetable / schedule builder |
| Validation | zod v4 | Every Server Action input is parsed by a zod schema |
| Toasts | sonner | |
| Host | Vercel | Fluid Compute, Node runtime. Do **not** set `runtime = 'edge'`. |

## 3. Architecture rules — non-negotiable

**Tenancy.** Shared schema, isolated by RLS. Every business table carries `org_id`,
plus `branch_id` where the row is branch-local. RLS policies read custom JWT claims
`{org_id, branch_ids[]}` plus a principal marker — `staff_role` and `staff_id` for staff,
`member_id` for members — set by a Supabase auth hook. Never filter tenants only
in application code — RLS is the boundary.

**Two principal types.** Since the mobile app landed, `org_id` is no longer proof of staff.
A member's token carries `org_id` too, so a policy that tests only `is_org_member(org_id)`
hands a member the whole gym's roster. Staff-facing read policies must also require
`jwt_is_staff()`; member-facing ones require `jwt_is_member()` and scope by `jwt_member_id()`.
The hook never sets the `role` claim: PostgREST reads that to pick the Postgres role for the
request, and overwriting it breaks every authenticated call.

**RLS is a release gate.** Every new table ships with RLS enabled and a cross-tenant
negative test (org A staff must not read org B rows). A migration that adds a table
without RLS is incomplete.

**Money.** Integer paisa in `bigint`. Never floats, never `numeric` for currency.
Format only at the render boundary.

**History, not overwrites.** Memberships are append-only — a renewal inserts a new
row, it never updates the old one. Refunds are negative payment rows with a reason.
Nothing financial is deleted.

**Derived status.** `members.status` is recomputed by trigger from memberships.
Never set it by hand from application code.

**Audit.** Mutations to members, memberships, payments, and plans write an
`audit_log` row (actor, action, entity, before/after). This is a cash business; the
audit trail is what makes the system trustworthy.

**Transactions.** Multi-table writes (renewal, check-in with dues, refund) go in a
Postgres RPC, not a sequence of client calls.

**Flutter-ready.** The member mobile app (later phase) talks to the same Postgres
under the same RLS. Keep business logic in the database or in Edge Functions, not
locked inside Next.js Server Actions, whenever the app will need it too.

## 4. Roles

| Role | Scope | Capabilities |
|---|---|---|
| `owner` | Whole org | Everything: staff, branches, plans, pricing, all reports, settings |
| `manager` | Assigned branches | Members, memberships, payments, classes, non-owner staff, branch reports |
| `front_desk` | One branch | Check-in, member CRUD, record payment, renew, book class, add a plan for their own branch |
| `trainer` | One branch | Own class sessions, own PT clients, mark attendance |

Roles are fixed. No custom permission builder in v1.

**Scope decision (2026-09-05): the front desk may create plans.** Registering a
member and selling them a plan is one act at the desk, and a plan that does not
exist yet is discovered at the counter with the member standing there. Waiting
for an owner to key it in is the paper register again.

The widening is deliberately narrow. A plan created by anyone who is not an
owner must name at least one branch, and every branch must be one they work at
-- never org-wide, never someone else's. RLS enforces it (`branch_ids <@
jwt_branch_ids()` plus a non-empty test); `canScopePlan` restates it so the form
can refuse readably; `supabase/tests/register_member.sql` is the gate. Editing,
deactivating and deleting plans stay with owners and managers, and `/plans` is
still an owner/manager screen -- the desk reaches plan creation only through the
inline dialog on the registration form. `membership_plans_audit` records who
added what.

Known gap: because the desk cannot open `/plans`, a duplicate plan name is
refused without them being able to see the plan they collided with.

**Scope decision (2026-09-07): archiving is the delete the desk gets.** "Delete
this member" at the counter means a duplicate entry or a walk-in who never came
back -- not "destroy the cash trail". So `members.archived_at` is its own axis,
separate from `left` (a fact about a member who stopped training, which reports
count on). Archiving hides the member from the list, the check-in search, the
dashboard tiles and the absent-members report, and changes no membership,
invoice or derived status; `archive_member` / `restore_member` carry it, and the
Archived filter on `/members` is where they come back from.

The real delete stays owner-only -- the `owners delete members` policy, plus
`requireRole('owner')` and a typed-name confirmation -- and takes the member's
memberships, invoices and payments with it through the cascade.

**Scope decision (2026-09-07): dates.** A sale may start in the future
(`register_member` now takes `p_start_date`, which `renew_membership` already
resolved and marks `upcoming`), and the window of a membership already sold can
be moved by `adjust_membership_dates` -- owner or the branch's manager only,
reason required, appended to the membership notes and recorded in `audit_log`.
Free days are money, so the front desk sells and freezes but does not move dates.

Moving the start date is the narrow exception to append-only. It is allowed only
through that RPC, only while the membership has no attendance behind it (once
someone has trained on it, when it started is a fact about attendance, not a
plan), and never while frozen. `guard_membership_immutability` stays the
enforcement point: it opens for `start_date` only when the function has set
`app.shift_membership_dates` on the transaction, which a direct PostgREST update
cannot do. The dialog shifts the end date by the same number of days, because
the member bought a term, not a pair of dates. Plan, price, discount, branch and
member remain immutable: this is not a rewrite of the sale.
Gate: `supabase/tests/member_archive_and_dates.sql`.

**Scope decision (2026-09-07): one way to say which branches.** A manager who
runs three branches could not previously ask any screen for their own total --
the dashboard silently showed them `branchIds[0]` and called it the branch. Scope
is now resolved once, in `lib/scope.ts`: an owner's default is every branch RLS
allows, a manager's is the union of their own, and a single-branch desk never
sees a switcher at all. The members list had a second, page-local branch filter;
it was deleted rather than reconciled, because two controls that can disagree
are worse than one.

**The `branch` parameter is a filter, never a permission.** RLS remains the
boundary: an id the caller does not cover falls back to their default scope
rather than erroring, and a forged one returns nothing. A stale bookmark is not
an attack and must not produce a dead screen.

**No branch is ever deleted.** A branch carries members, cash and attendance.
`/branches` deactivates instead, and the `owners delete branches` policy left
over from the foundation migrations was dropped, so the rule is enforced by the
database rather than by the absence of a button. Note that nothing reads
`branches.status` yet -- deactivating changes the branch list and nothing else.

**Payment status at the point of sale.** Registration and renewal both ask what
actually came in -- paid in full, part paid, or unpaid -- because a failed QR
must not be recorded as cash. An unpaid sale still raises the invoice in full,
so the due lands on the profile and in the arrears report.

**Reversals (2026-09-07).** When money was recorded but never received -- "I'll
pay tomorrow", said after the sale was rung up -- the correction is
`reverse_payment`, a third `payment_kind` beside `payment` and `refund`. It is
mechanically a refund (a negative row the invoice totals follow back into a due)
but reported separately, because a refund says cash left the drawer and gross
takings should not count a note that never arrived. Owner and the branch's
manager only: the person who recorded the money is not the person who gets to
say it never came. Payments stay immutable and nothing is deleted.
Gate: `supabase/tests/reverse_payment.sql`.

**Scope decision (2026-09-08): the visitor log is a log, not a CRM.** `docs/PRD.md`
names a lead pipeline a non-goal, and it stays one. What was missing is smaller
and concrete: the person who walks in asking what a month costs, and the guest
who trains for a day, both end up on a paper pad, and the pad is where the
callback dies. So `visitors` -- name, mobile, the org's own today, which branch,
enquiry or guest, one note, one plan they asked about, and a status of
new / contacted / converted / lost.

Deliberately narrow. No reminders, no assignment to a staff member, no
campaigns, no conversion-rate report, and no link into `attendance` -- a guest
is not a check-in, and check-in needs a member. Drip follow-ups are a new scope
decision, not an extension of this.

Every role logs one, trainers included: a walk-in asks whoever is standing
there. Reads are org-wide like members, so someone who enquired at one branch is
found at another rather than logged twice. Logging one is branch-scoped -- a
walk-in happens at a place, and `branch_id` records it -- but following one up
(status, note, conversion) is org-wide, because the callback is made by whoever
has the number. The delete is owner-only. `converted` is not a status
anyone picks -- `convert_visitor` sets it after `register_member` has returned
a member, and the check constraint refuses the status without one. Registering
from a visitor row prefills the name and mobile, and the link is written after
the member exists: a failure there leaves a real member and an unconverted
visitor, which is a correctable mistake, where refusing the registration would
not be.
Gate: `supabase/tests/visitors.sql`.

## 5. Data model

```
orgs
 └── branches
      ├── staff            (org row, scoped by branch_ids[])
      ├── members          (home_branch_id; auth_user_id nullable → Flutter hook)
      │    ├── memberships (append-only history)
      │    │    └── invoices
      │    ├── payments
      │    ├── attendance
      │    └── class_bookings
      ├── membership_plans
      ├── visitors        (walk-ins; converted ones point at a member)
      ├── classes
      │    └── class_sessions   (materialized 60 days ahead by pg_cron)
      └── pt_sessions
audit_log
```

`members.phone` is unique per org — phone is the identity anchor in this market.

## 6. Conventions

**Files**
```
app/(auth)/...              login, signup, invite acceptance
app/(app)/...               authenticated staff console, shared shell
app/(app)/[module]/...      one route group per module
components/ui/...           shadcn primitives — do not edit by hand
components/<module>/...     feature components
lib/supabase/{server,client,middleware}.ts
lib/db/<module>.ts          typed queries for one module
lib/validation/<module>.ts  zod schemas
```

- Server Components fetch; Client Components interact. Push `"use client"` as far down the tree as possible.
- Writes go through Server Actions that parse input with zod, then call a typed `lib/db` function or an RPC.
- Generate DB types with the Supabase MCP `generate_typescript_types` after every migration. Do not hand-write row types.
- Currency, dates, and times render through shared helpers — NPR and Asia/Kathmandu, per-org configurable.
- Every list view: server-side pagination, search, and an empty state. Front-desk screens are 1366×768 — design for that width.

**Naming**
- Tables and columns: `snake_case`, plural tables.
- TypeScript: `camelCase` values, `PascalCase` types and components.
- Migrations: descriptive names, one logical change each.

**Git**
- Branch off `main` per phase task. Conventional Commits.
- Never commit secrets. Supabase keys live in Vercel env vars and `.env.local`.
- `AGENTS.md` is regenerated by `next dev` — commit it with your work rather than reverting it.

## 7. Delivery phases

Ordered and strictly sequential. Detail in `TASKS.md`.

0. **Foundation** — schema, RLS, JWT claims, staff auth, app shell, isolation tests
1. **Member spine** — members, plans, memberships, payments, dues, expiry
2. **Front desk** — check-in, attendance, in-gym count, absent report
3. **Chain layer** — HQ dashboard, per-branch drill-down, reports, CSV export
4. **Classes** — timetable, bookings, waitlists, trainers, PT session packs
5. **Notifications** — SMS/Viber renewal and dues reminders
6. **Flutter member app** — email invite auth, QR check-in, booking, push

## 8. Out of scope for v1

Card-on-file / Stripe recurring billing · member web self-service · POS and retail
inventory · payroll and HR · biometric turnstiles · workout program builder ·
marketing automation and CRM · accounting-package integration (CSV export only).

Do not build these without an explicit decision to change scope.

## 9. Current state (2026-09-05)

- Phase 0 shipped: tenant schema, JWT claims hook, RLS, staff auth, invite flow, app shell.
- Phase 1 schema shipped: `members`, `membership_plans`, `memberships`, `invoices`,
  `payments`, `member_overview` view, RPCs (`renew_membership`, `record_payment`,
  `refund_payment`, freeze/unfreeze/cancel, left/reactivate), reports
  (`daily_collection`, `arrears_report`), nightly `pg_cron` expiry sweep.
  Gate: `supabase/tests/member_spine.sql`.
- `lib/db/{members,plans,memberships,payments}.ts` and `lib/validation/{members,plans,payments}.ts`
  are the typed boundary the UI goes through.
- Phase 2 shipped: `attendance` (one row per visit, with a snapshot of the status
  and dues the desk saw), RPCs `check_in_member` / `check_out_member`, the
  `attendance_banner` verdict function, the `attendance_detail` view, reports
  (`in_gym_now`, `absent_members`, `attendance_day_summary`), the `/check-in`
  console, the attendance tab on the member profile, and `/reports/absent`.
  Gate: `supabase/tests/front_desk.sql`.
- QR check-in tokens are minted and verified in Postgres (`mint_qr_token`,
  `verify_qr_token`), HMAC-signed with a key held in `supabase_vault` and created
  on first use, so nothing has to be provisioned by hand. Unused until Phase 6.
  The old `qr-token` Edge Function is a retired 410 stub.
- Phase 1 and Phase 2 migrations are mirrored in `supabase/migrations/`; Phase 0
  ones are still remote-only.
- Registration sells a plan in the same submit: `register_member()` inserts the
  member and delegates to `renew_membership()` in one transaction, so a refused
  sale registers nobody. Failures are attributed with a `hint` of `member` or
  `sale` so the Server Action lands the message on the right field.
  Gate: `supabase/tests/register_member.sql`.
- Printed documents ship outside the phase plan (2026-09-06): an A4 invoice and
  payment receipt on the org letterhead, rendered by the browser's own print
  engine from `app/(print)/` -- a sibling route group, so the console shell is
  absent from the paper *and* from the on-screen preview. No PDF dependency; the
  user prints or saves as PDF. `orgs` gained the letterhead columns, the
  `org-logos` bucket is public with owner-only writes, and `/settings` (owner
  only) is where a gym fills all of it in. `renew_membership` now records
  `memberships.signup_fee_paisa` so the joining fee can print as its own line;
  rows written earlier carry 0 and print as one line, which is correct -- the
  split does not exist for them.
- DNS resolved directly to Vercel (Cloudflare proxy disabled); single DMARC record in place.
- Phase 3 shipped: the chain layer. Branch scope is resolved once, server-side
  (`lib/scope.ts`), from a `?branch=` parameter plus an `lg_branch` cookie, and
  every screen reads it; the switcher sits in the app shell. The five Phase 1-2
  report functions now take `p_branch_ids uuid[]` instead of a single branch id.
  `org_snapshot` feeds an HQ dashboard whose every number links into the screen
  that already shows that detail. `/branches` is an owner-only admin screen, and
  an existing staff row's role and branches are editable. Four chain reports --
  `revenue_report`, `membership_movement`, `attendance_trend`, `plan_mix` -- with
  CSV export on all seven report screens through `/api/reports/<report>/csv`.
  Gate: `supabase/tests/chain_layer.sql`.
- Next task: Phase 4, classes. The schema and the booking RPCs already exist
  (shipped early, in Phase 0-2); what is missing is the timetable UI, the
  `pg_cron` session materializer, `pt_sessions`, and trainer utilization.
  See `TASKS.md`.
