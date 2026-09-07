# Phase 3 — Chain layer

Date: 2026-09-07 · Status: approved, ready for planning
Context: `PLANNING.md` §7 (phase 3), `TASKS.md` → Phase 3, `docs/PRD.md`.

Phase 3 turns a console that shows one branch at a time into one that shows a
chain. Three subsystems, built in that order because the first is a dependency
of the other two:

1. **Branch scope** — a single way to say "which branches am I looking at",
   plus the HQ dashboard and drill-down that consume it.
2. **Branch and staff administration** — the `/branches` screen the nav already
   links to, and editing an existing staff row's role and branches.
3. **Chain reports** — revenue, membership movement, attendance trend, plan
   mix, each with CSV export.

---

## 1. Branch scope

### The problem it fixes

`app/(app)/page.tsx` today reads:

```ts
const scopeBranchId = isOwner ? undefined : staff.branchIds[0]
```

A manager who covers three branches sees the first one, with no indication that
the other two are missing from the numbers. Every report added in this phase
would inherit that bug. Scope is therefore resolved once, in one place, and
every screen reads it.

### Resolution rule

`lib/scope.ts` exports `resolveBranchScope(searchParams, staff)` returning:

```ts
type BranchScope = {
  branchIds: string[] | null   // null = every branch the caller may see
  selectedId: string | null    // null = the aggregate ("All branches")
  label: string                // "All branches" | "All my branches" | branch name
  options: { id: string; name: string }[]  // what the switcher may offer
  canSwitch: boolean
}
```

| Role | Default | May narrow to |
|---|---|---|
| `owner` | `null` — the whole chain | any branch in the org |
| `manager` | the union of `staff.branchIds` | any branch they cover |
| `front_desk`, `trainer` | their single branch | nothing; switcher not rendered |

`?branch=<uuid>` selects one branch and wins over everything else. An id the
caller does not cover is **ignored, not honoured** — resolution falls back to
the default scope rather than erroring, because a stale bookmark is not an
attack and should not produce a dead screen.

### State

- **URL** `?branch=<uuid>` is what the Server Components read. Drill-down is
  therefore an ordinary `<Link>`, back/forward work, and a link is shareable.
- **Cookie** `lg_branch` remembers the last explicit choice so the next session
  opens where the user left off. Written by the switcher only; never read in
  preference to the URL.

**The parameter is a filter, never a permission.** RLS remains the boundary: a
forged or borrowed branch id returns an empty result set, not another manager's
rows. The scope-negative tests in the gate assert exactly this.

### Component

`components/app/branch-switcher.tsx` in the app shell header, rendered only when
`canSwitch`. Selecting a branch navigates to the current path with the parameter
replaced, so the switcher works on every screen without per-screen wiring. This
closes the last open Phase 0 task.

### Database change

The existing report functions take `p_branch_id uuid default null`. A union of
branches cannot be expressed that way, so the parameter becomes an array:

| Function | Old | New |
|---|---|---|
| `daily_collection` | `p_branch_id uuid` | `p_branch_ids uuid[] default null` |
| `arrears_report` | `p_branch_id uuid` | `p_branch_ids uuid[] default null` |
| `in_gym_now` | `p_branch_id uuid` | `p_branch_ids uuid[] default null` |
| `absent_members` | `p_branch_id uuid` | `p_branch_ids uuid[] default null` |
| `attendance_day_summary` | `p_branch_id uuid` | `p_branch_ids uuid[] default null` |

`null` keeps its present meaning: every branch RLS allows.

**Replace the signature, do not overload it.** Two signatures that both default
their only argument make a no-argument call ambiguous in Postgres. The old
functions are dropped in the same migration and the `lib/db` call sites updated
together.

Out of scope for this change: the *write* RPCs that take a `p_branch_id`
(`check_in_member`, `renew_membership`, `register_member`). Those act on one
branch by definition and keep their scalar parameter.

## 2. HQ dashboard and drill-down

### `org_snapshot(p_branch_ids uuid[] default null)`

One RPC returning one row per branch in scope, plus a totals row
(`branch_id is null`):

| Column | Meaning |
|---|---|
| `branch_id`, `branch_name` | `null` on the totals row |
| `active_members` | `members.status = 'active'`, archived excluded |
| `collected_today_paisa` | net of refunds *and* reversals |
| `check_ins_today` | attendance rows for the org's today |
| `expiring_7d` | active memberships ending within 7 days |
| `dues_paisa` | outstanding across unpaid and part-paid invoices |

Today's dashboard issues one `dailyCollection()` per branch through
`Promise.all` — an N+1 that grows with the chain. One RPC replaces it.

"Today" is the gym's today: `org_today(p_org_id)`, Asia/Kathmandu, already used
by the attendance and collection code. Archived members are excluded everywhere,
consistent with the 2026-09-07 archiving decision.

Reversals are netted out of `collected_today_paisa` the same way refunds are —
the money did not arrive either way — while the reports in §4 keep them in
separate columns, because *why* the drawer is short is the point of a report and
not of a tile.

### Screen

`app/(app)/page.tsx` becomes: aggregate tiles across the scope, then a
per-branch table beneath them. Every number in the table is a link into the
screen that already shows that detail, scoped:

- active members → `/members?branch=<id>&status=active`
- collected today → `/payments?view=collection&branch=<id>`
- check-ins → `/check-in?branch=<id>`
- expiring → `/members?branch=<id>&filter=expiring`
- dues → `/payments?view=arrears&branch=<id>`

Drill-down is navigation, not a new page. Nothing is built that a screen already
does.

A single-branch org sees the tiles and no table — the table is noise when it has
one row.

## 3. Branch and staff administration

### `/branches` — owner only

List, create, edit (`name`, `address`, `phone`), and **deactivate**. There is no
delete: a branch carries members, cash and attendance, and the financial-history
rule forbids destroying it. Deactivating is `branches.status = 'inactive'`; the
branch stops being offered for new registrations and new staff assignment, and
keeps every row it already owns.

Before writing the screen, confirm `branches` carries owner insert/update
policies. If it does not, they ship in this migration with the same shape as
`membership_plans` — a table without the policies its screen needs is the same
release-gate failure as a table without RLS.

### Staff role and branch reassignment

`updateStaffAssignment(staffId, role, branchIds)` — a Server Action beside the
existing `inviteStaff` / `setStaffStatus` in `app/(app)/staff/actions.ts`, zod
parsed. Today the only way to change either field is to deactivate and
re-invite.

Guards, enforced in the database as well as the action:

- Owner may set any role and any branches.
- Manager may edit `front_desk` and `trainer` rows only, and only within the
  branches they themselves cover.
- The last active `owner` in an org cannot be demoted.
- Nobody changes their own role.
- A non-owner role must carry at least one branch — the same non-empty rule the
  plan-scoping decision already applies.

Role changes take effect on the staff member's next token refresh; the screen
says so, rather than implying the change is instant.

## 4. Chain reports

Four functions, all sharing the shape
`(p_branch_ids uuid[] default null, p_from date, p_to date, …)` and all
respecting RLS as the caller.

| Function | Returns | Notes |
|---|---|---|
| `revenue_report` | period × branch × method, gross, refunds, reversals, net | Reversals separate from refunds; that distinction is the whole reason `reverse_payment` exists |
| `membership_movement` | per period: new members, renewals, expiries, churn | "New" is a member's first membership; "renewal" is any later one — the append-only history makes this readable |
| `attendance_trend` | check-ins per day/week per branch, plus unique members | Feeds the recharts line |
| `plan_mix` | active memberships and revenue by plan | Which plans actually sell |

Grouping granularity (`day` / `week` / `month`) is a parameter, not four
functions.

### Screens

`/reports/revenue`, `/reports/movement`, `/reports/attendance`,
`/reports/plans`, each reached from the `/reports` index that already exists.
Shared period picker: today, last 7 days, last 30 days, this month, custom
range. recharts for the trend; tables for the rest, because a manager reconciles
against numbers, not a shape.

### CSV export

`app/api/reports/[report]/csv/route.ts` — a Route Handler taking the same search
parameters as the page, re-running the query **as the caller** through the
cookie-bound Supabase client, and streaming the whole result set with a
`Content-Disposition` filename naming the report, the scope and the date range.

Server-side because the export must contain the full report rather than the
page currently on screen, and because running it as the caller means RLS applies
to the file exactly as it applied to the page.

## 5. Gates

New file `supabase/tests/chain_layer.sql`, following the existing gate style:

- Cross-tenant negative for every new function: org A staff calling it must not
  see org B rows, whatever they pass in `p_branch_ids`.
- Branch-scope negative: a manager passing a branch id they do not cover gets
  their own scope back, never that branch's rows.
- `org_snapshot` totals equal the sum of its branch rows.
- `revenue_report` net equals gross minus refunds minus reversals, cross-checked
  against `daily_collection` for the same day and branch.
- Archived members absent from `org_snapshot.active_members`.
- `updateStaffAssignment` guards: last owner not demotable, self-role change
  refused, non-owner with an empty branch list refused.

`npm run db:test` is extended to run all gate files. It runs four of nine today
(`tenant_isolation`, `member_spine`, `front_desk`, `register_member`), leaving
`classes`, `member_app`, `push`, `member_archive_and_dates`, `reverse_payment`
and the new `chain_layer` unrun by any script.

## 6. Non-goals

- No new detail pages: drill-down reuses the screens that exist.
- No branch delete, ever.
- No custom permission builder — roles stay the four in `PLANNING.md` §4.
- No scheduled or emailed reports; CSV is the export story for v1.
- Phase 4 class reporting (trainer utilization) is not part of this.
