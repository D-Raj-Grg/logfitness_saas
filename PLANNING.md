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
`{org_id, role, branch_ids[]}` set by a Supabase auth hook. Never filter tenants only
in application code — RLS is the boundary.

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
| `front_desk` | One branch | Check-in, member CRUD, record payment, renew, book class |
| `trainer` | One branch | Own class sessions, own PT clients, mark attendance |

Roles are fixed. No custom permission builder in v1.

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
- Phase 1 migrations are mirrored in `supabase/migrations/`; Phase 0 ones are still remote-only.
- `lib/db/{members,plans,memberships,payments}.ts` and `lib/validation/{members,plans,payments}.ts`
  are the typed boundary the UI goes through.
- DNS resolved directly to Vercel (Cloudflare proxy disabled); single DMARC record in place.
- Next task: finish the Phase 1 screens, then Phase 2. See `TASKS.md`.
