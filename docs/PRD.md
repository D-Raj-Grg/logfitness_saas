# Lord of Gyms — Product Requirements Document

**Status:** Draft v1
**Date:** 2026-09-05
**Owner:** Divyashwar Raj
**Production:** https://app.lordofgyms.com (staff console) · https://lordofgyms.com (marketing)

---

## 1. Summary

Lord of Gyms is a multi-branch gym management SaaS for gym chains in Nepal and South Asia. It replaces the register books, Excel sheets, and WhatsApp reminders that chains currently use to track members, membership dues, daily attendance, and class schedules across locations.

The v1 product is a **web console used only by gym staff**. Gym members are records in the system, not users. A **Flutter member app (iOS + Android)** ships in a later phase; the v1 data model and auth model are designed so that app drops in without schema rework.

## 2. Problem

Multi-branch gym chains in Nepal run on paper and spreadsheets:

- **Revenue leaks.** Nobody knows which members have expired or owe dues until they stop showing up. Renewal reminders are manual and inconsistent.
- **No consolidated view.** The owner cannot see today's collection, active member count, or attendance across branches without calling each branch manager.
- **Cash is untraceable.** Payments are collected at the front desk in cash. There is no record of who collected what, so shrinkage is invisible.
- **Class and trainer scheduling is ad hoc.** Timetables live on a whiteboard; capacity and trainer conflicts are discovered on the floor.
- **Member data is trapped per branch.** A member who moves between branches is re-registered from scratch.

Existing global SaaS (Mindbody, Glofox, Zen Planner) assumes card-on-file recurring billing, prices in USD, and does not model cash collection or local payment rails. Local alternatives are single-branch desktop software with no multi-tenant or reporting story.

## 3. Target customer

**Primary:** Gym chains with **3–50 branches** in Nepal and South Asia, 500–20,000 total members, with an HQ/owner layer above branch managers.

**Buyer:** Chain owner or operations head. Sales-led, not self-serve.
**Daily users:** Front-desk staff (highest volume), branch managers, trainers.
**Weekly users:** Owner (reports), HQ finance.

Explicitly **not** the initial target: solo PT trainers, single-location boutique studios, corporate wellness. These may be served later by the same product at a lower tier.

## 4. Goals and non-goals

### Goals

| # | Goal | Success measure |
|---|---|---|
| G1 | Kill the register book | 100% of member records and payments entered in-app within 30 days of onboarding |
| G2 | Stop revenue leaking on expiry | Renewal rate on expiring memberships improves vs. the chain's pre-adoption baseline |
| G3 | Give the owner one live cross-branch view | Owner opens the HQ dashboard ≥3×/week |
| G4 | Make cash traceable | Every payment row carries a collector and timestamp; daily close matches drawer |
| G5 | Front desk is faster than paper | Check-in ≤3 seconds; new member registration ≤90 seconds |

### Non-goals (v1)

- Card-on-file / auto-recurring billing (no Stripe).
- Member self-service on web.
- Point-of-sale, retail inventory, supplement sales, locker rental.
- Payroll, HR, biometric/turnstile hardware integration.
- Workout program builder, exercise library, body-composition tracking.
- Marketing automation, lead pipeline, CRM.
- Accounting-package export (CSV export only).

Each non-goal is a candidate for a later phase, not a permanent exclusion.

## 5. Market and money model

**Market:** Nepal first, South Asia next. Currency NPR, timezone Asia/Kathmandu, per-org configurable.

**How members pay the gym:** Predominantly **cash at the front desk**. Digital rails in use are **eSewa, Khalti, FonePay QR, and bank transfer** — all of which are push payments confirmed after the fact, not card-on-file pulls.

**Consequence for the product:** billing is *recording and chasing*, not *charging*. The system must:

- Let staff record a payment against a membership with method + reference number.
- Track partial payments and outstanding dues.
- Compute membership expiry and surface who is expiring, expired, or in arrears.
- Send renewal and due reminders (SMS/Viber in Nepal; push once the Flutter app ships).

A `payment_provider` abstraction is specified so an online gateway (eSewa/Khalti API, or Stripe for a future global tier) can be added without schema change. No gateway integration in v1.

**How the chain pays us:** Per-branch monthly subscription, billed offline by the vendor in v1. Subscription tier is a field on `orgs` gating branch count and features. No in-app SaaS billing in v1.

## 6. Users and roles

| Role | Scope | Capabilities |
|---|---|---|
| `owner` | All branches in the org | Everything: staff, branches, plans, pricing, all reports, settings |
| `manager` | Assigned branches | Members, memberships, payments, classes, non-owner staff, branch reports |
| `front_desk` | One branch | Check-in, member CRUD, record payment, renew membership, book class |
| `trainer` | One branch | Own class sessions, own PT clients, mark attendance |

Roles are fixed in v1 — no custom permission builder. Staff authenticate with email + password via Supabase Auth. Members do **not** authenticate in v1.

## 7. Architecture

### Tenancy — shared schema with RLS (decided)

Every business table carries `org_id`, plus `branch_id` where the row is branch-local. Supabase Row Level Security scopes all access off custom JWT claims `{org_id, role, branch_ids[]}`, populated by a Supabase auth hook at token issue. Policies read claims directly rather than sub-selecting the staff table, keeping the hot path fast.

Alternatives considered and rejected:
- *Schema-per-tenant* — hard isolation, but migrations multiply per tenant, PostgREST/RLS tooling fights it, and provisioning becomes a job. Overkill below ~1000 tenants.
- *App-layer filtering with no RLS* — one missed `org_id` filter is a cross-tenant data leak, and the future Flutter app would need a bespoke API for every read. Rejected outright.

**Isolation is a correctness requirement, not a best-effort.** Every table gets RLS enabled, and the test suite includes cross-tenant negative tests (org A staff must not read org B rows) as a release gate.

### Surfaces

- **Web staff console** — Next.js 16 App Router on Vercel. Server Components for reads, Server Actions for writes, `@supabase/ssr` for cookie-based session handling. shadcn/ui + Tailwind v4, recharts for dashboards.
- **Flutter member app** (later phase) — `supabase_flutter` talking to the same Postgres under the same RLS policies. No separate backend.
- **Edge Functions** — only for what RLS cannot express: QR check-in token mint/verify, payment-gateway webhooks, push notification fanout.
- **Scheduled jobs** (`pg_cron`) — nightly membership expiry sweep, renewal reminder queue, class-session materialization.

### Money representation

All amounts stored as integer **paisa** in `bigint`. Never floating point. Currency is per-org, fixed NPR at launch.

### Auditability

`audit_log` captures actor, action, entity, and before/after JSON for every mutation on members, memberships, payments, and plans. In a cash business this is the control that makes the system trustworthy to an owner.

## 8. Data model

```
orgs
 └── branches
      ├── staff            (org-level row, scoped to branch_ids[])
      ├── members          (home_branch_id; auth_user_id nullable → Flutter app hook)
      │    ├── memberships (history rows; renewal = new row, never an update)
      │    │    └── invoices
      │    ├── payments
      │    ├── attendance
      │    └── class_bookings
      ├── membership_plans (org-level, optionally branch-scoped)
      ├── classes
      │    └── class_sessions
      └── pt_sessions
audit_log                  (org-level)
```

Key field notes:

- `members.phone` — unique per org. Phone is the practical identity anchor in Nepal; national ID is not reliably collected.
- `members.status` — `active | expired | frozen | left`, recomputed by trigger from the member's memberships. Never hand-edited.
- `memberships` — append-only history. Renewal inserts a row with `start_date = max(today, previous end_date)`. Enables lifetime-value and churn analysis for free.
- `membership_plans.plan_type` — `time` (duration_days) or `session_pack` (session_count). Session packs decrement `memberships.sessions_remaining`.
- `payments.method` — `cash | esewa | khalti | fonepay | bank | card`, with `reference_no` for digital rails and `collected_by` staff FK always required.
- `class_sessions` — materialized from each class's recurrence rule 60 days forward by cron, so bookings attach to concrete rows.

### Representative transaction — membership renewal

Front desk opens a member → *Renew* → picks a plan → one Postgres RPC executes in a single transaction:

1. Insert `memberships` row (`start_date = max(today, prev.end_date)`).
2. Insert `payments` row with method, amount, and `collected_by`.
3. Insert or update `invoices` with total / paid / due.
4. Trigger recomputes `members.status`.
5. Insert `audit_log` row.

Partial payment is the normal case, not an edge case: the invoice carries a due balance and the member appears in the arrears report.

## 9. Modules

### M1 — Members
Register, search (by phone, name, or member ID), edit, photo, emergency contact, freeze/unfreeze, mark left. Member profile shows membership history, payment history, attendance history, and outstanding dues on one screen. Members belong to a home branch but are visible org-wide so a member can use any branch.

### M2 — Memberships and plans
Plan catalogue per org (name, duration or session count, price, branch availability). Assign plan, renew, upgrade, freeze with automatic expiry extension, cancel. Expiry computed nightly. Dashboards for *expiring in 7 days*, *expired*, and *frozen*.

### M3 — Payments and dues
Record payment against a membership with method and reference. Partial payments and due tracking. Daily collection sheet per branch per staff member for drawer reconciliation. Arrears list with age buckets. Refunds recorded as negative payment rows with a reason, never by deleting.

### M4 — Check-in and attendance
Front-desk check-in by phone/name search or member ID. On check-in the screen states plainly whether the membership is active, expiring, or expired, and whether dues are outstanding — this is the moment a renewal is sold. "In the gym now" live count. Attendance history per member. *Absent 14+ days* report as a churn early-warning signal. QR check-in is designed in the token model but only used once the Flutter app ships.

### M5 — Branches and staff
Create branches, invite staff by email, assign role and branches, deactivate. HQ dashboard aggregating active members, today's collection, today's check-ins, and expiring memberships across all branches, with drill-down per branch.

### M6 — Classes and trainers
Class definitions with trainer, capacity, room, and recurrence. Materialized session calendar. Front-desk booking of members into sessions, with waitlist when at capacity. Trainer marks attendance. PT sessions tracked against session-pack memberships, decrementing the remaining count.

### M7 — Reports
Revenue by branch / period / payment method. New members, renewals, and churn per period. Attendance trend. Trainer utilization. Plan mix. CSV export on every report.

### M8 — Notifications
Renewal reminder at T-7 and T-1 days, dues reminder, birthday greeting. SMS/Viber via a Nepali gateway in v1; push notifications once the Flutter app ships. Templates editable per org.

## 10. Delivery phases

Phases are strictly ordered. Each is independently shippable and gets its own spec and implementation plan.

**Phase 0 — Foundation**
Supabase schema for orgs / branches / staff, RLS policies, JWT claims auth hook, staff invite and login, app shell with role-aware navigation, cross-tenant isolation test suite.

**Phase 1 — Member spine (M1 + M2 + M3)**
The minimum that replaces the register book: members, plans, memberships, payments, dues, expiry. A chain can run on this alone.

**Phase 2 — Front desk (M4)**
Check-in, attendance, in-gym count, absent-member report. Drives daily usage and makes the product sticky.

**Phase 3 — Chain layer (M5 + M7)**
HQ dashboard, per-branch drill-down, reports and exports. This is what the owner buys.

**Phase 4 — Classes (M6)**
Timetable, bookings, waitlists, trainers, PT session packs.

**Phase 5 — Notifications (M8)**
SMS/Viber reminders and templates.

**Phase 6 — Flutter member app**
Invite-based email auth linking to the existing `members.auth_user_id` (phone OTP deferred), QR check-in, plan and dues visibility, class booking, push notifications.

## 11. Success metrics

**Product**
- Front-desk check-in completes in ≤3 seconds; new member registration in ≤90 seconds.
- ≥80% of a chain's active members have a check-in recorded in the last 30 days (proves real adoption, not shelfware).
- Owner opens the HQ dashboard ≥3×/week.

**Business**
- Renewal rate on expiring memberships improves against each chain's own pre-adoption baseline.
- Time-to-first-value under 7 days from contract to a branch running live.
- Net revenue retention above 100% via branch expansion within existing chains.

**Technical**
- p95 page load under 2s on a 4G connection in Kathmandu.
- Zero cross-tenant data leaks; isolation tests are a release gate.
- Console usable on a 1366×768 front-desk screen — the most common hardware in the market.

## 12. Risks

| Risk | Mitigation |
|---|---|
| RLS misconfiguration leaks data across chains | Cross-tenant negative tests as a release gate; RLS enabled on every table by default; policy review in code review |
| Staff revert to the register book | Phase 2 check-in makes the app the fastest path through the front desk; onboarding includes data migration from existing sheets |
| Unreliable connectivity at branches | Aggressive caching, optimistic UI on check-in; offline-first is explicitly deferred, not solved, in v1 |
| Cash reconciliation disputes | Every payment carries a collector and timestamp; daily collection sheet per staff member; audit log is immutable |
| Scope creep from POS / inventory requests | Named non-goals; revisit only after Phase 4 ships |
| Nepali SMS gateway reliability | Provider abstraction behind a single interface; fall back to push once the app ships |

## 13. Open questions

- Which SMS/Viber gateway for Nepal, and what is the per-message cost at chain volume?
- Do chains need branch-specific pricing for the same plan, or is org-wide pricing sufficient?
- Is a member's home branch binding for billing, or can any branch collect a renewal?
- What existing data formats must be migrated at onboarding (Excel layouts vary per chain)?
- Nepali-language UI — required at launch, or English-only for staff?
- Phone OTP member login — deferred in favour of invite/email; revisit once an SMS gateway is chosen.
