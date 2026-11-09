@AGENTS.md

# Lord of Gyms — session rules

## Start of every conversation

1. **Read `PLANNING.md` first.** It holds the architecture, stack, tenancy model, and conventions. Do not propose or write code before reading it.
2. **Read `TASKS.md` before starting work.** Pick up the current phase. Do not skip ahead to a later phase without an explicit instruction.
3. **Mark tasks `[x]` in `TASKS.md` the moment they are complete** — not at the end of the session.
4. **Add newly discovered tasks to `TASKS.md`** as you find them, under the phase they belong to or under **Discovered**.

Product context lives in `docs/PRD.md`. Read it when scope or priority is in question.

## Hard rules

- **RLS is the tenant boundary.** Every business table carries `org_id` (and `branch_id` where branch-local), ships with RLS enabled, and gets a cross-tenant negative test. A migration adding a table without RLS is incomplete.
- **Money is integer paisa in `bigint`.** Never floats. Format only at the render boundary.
- **Financial history is append-only.** Renewals insert a new `memberships` row. Refunds are negative `payments` rows with a reason. Nothing financial is deleted or overwritten.
- **`members.status` is trigger-derived.** Never set it from application code.
- **Multi-table writes go in a Postgres RPC**, not a sequence of client calls.
- **Audit every mutation** to members, memberships, payments, and plans.
- **Next.js 16 has breaking changes vs. training data.** Read `node_modules/next/dist/docs/` before writing Next code. Do not set `runtime = 'edge'`.
- **Schema changes go through Supabase MCP `apply_migration`**, never ad-hoc `execute_sql` DDL. Regenerate TypeScript types after each migration.
- **Server Actions parse input with zod** before touching the database.
- **Keep logic the Flutter app will need in the database or Edge Functions**, not locked inside Server Actions.

## Scope discipline

v1 excludes: card-on-file/Stripe recurring billing, member web self-service, POS and
inventory, payroll/HR, biometric hardware, workout program builder, marketing/CRM,
accounting integrations. Do not build these without an explicit scope decision.

**RFID card check-in came in on 2026-10-12**, an explicit scope decision: an ESP32 + RC522
door reader checks members in by card and answers allow/deny (see `TASKS.md` Phase 2). It
is cards only -- biometrics and turnstile relays are still out.

**Staff cards came in on 2026-11-04**, a second explicit scope decision: a staff member can
hold a card too, and a tap at the door clocks them in or out in their own `staff_attendance`
table (never the members' `attendance`). One card UID is live for one holder across members
and staff. Offline readers learn staff cards with firmware 1.3.0 (a reader on older firmware
still answers a staff tap as unknown while offline). Payroll/HR stays out -- this records presence, not pay.

**Printed card numbers, a public balance page and renewal requests came in on 2026-11-08**, a
third explicit scope decision. A card carries a printed number (`NO. 0004`) that is stock, not
identity: `card_stock` is one row per physical card, reused across members; `members.member_code`
is untouched. The QR on a card opens `…/balance?card_no=0004` -- the gym's own site or the console's
`app/(public)/balance` -- which shows a masked name, plan and days left to anyone holding the card,
and takes a renewal *request* the desk fulfils at the counter. It is not member self-service: no
login, no payment, no phone or dues on the page. The card designer (`/cards/designer`) is the one
place a PDF library runs (`pdf-lib` + `qrcode`, browser only); invoices and receipts still print
from the browser.


1. Always read the PLANNING.md at the start of every new conversation 
2. Check TASKS.md before starting your work
3. Mark completed tasks immediately
4. Add newly discovered tasks