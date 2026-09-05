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
