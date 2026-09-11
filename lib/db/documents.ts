import { createClient } from '@/lib/supabase/server'

/**
 * Reads for the printed documents. They live apart from lib/db/memberships.ts
 * and lib/db/payments.ts because an invoice on paper is a different shape from
 * an invoice in a table: it needs the member, the branch that sold it, and the
 * org letterhead in one consistent snapshot.
 *
 * One nested select rather than several queries. Composite-FK embeds are
 * already proven in this schema (payments -> staff), and every joined table is
 * org-wide readable for staff -- with one exception, payments, whose select
 * policy is branch-scoped. See getInvoiceForPrint below.
 */

const ORG_LETTERHEAD = `
  name, legal_name, address, phone, email,
  pan_no, tax_note, invoice_terms, logo_path, currency, timezone
`

const MEMBER_FIELDS = 'member_code, full_name, phone, email, address'

const BRANCH_FIELDS = 'name, address, phone'

/**
 * Everything an invoice prints.
 *
 * Caveat that matters: `payments` has a branch-scoped select policy
 * (`is_org_member(org_id) and (jwt_is_owner() or has_branch_access(branch_id))`),
 * so a manager who does not cover the selling branch gets an EMPTY payments
 * array on an invoice that is genuinely paid. Never infer "unpaid" from an
 * empty list -- invoice.paid_paisa and due_paisa are trigger-maintained on the
 * invoice row itself and are always right. The document says so in words.
 */
export async function getInvoiceForPrint(invoiceId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('invoices')
    .select(
      `
      *,
      member:members!invoices_member_fkey(${MEMBER_FIELDS}),
      membership:memberships!invoices_membership_fkey(
        plan_name, plan_type, start_date, end_date, sessions_total,
        price_paisa, signup_fee_paisa, signup_fee_waived_paisa, discount_paisa,
        previous_membership_id,
        seller:staff!memberships_sold_by_fkey(full_name)
      ),
      branch:branches!invoices_branch_fkey(${BRANCH_FIELDS}),
      org:orgs!invoices_org_id_fkey(${ORG_LETTERHEAD}),
      payments:payments!payments_invoice_fkey(
        id, kind, amount_paisa, method, reference_no, paid_at,
        collector:staff!payments_collected_by_fkey(full_name)
      )
    `
    )
    .eq('id', invoiceId)
    .maybeSingle()

  if (error) throw error
  return data
}

export type InvoiceForPrint = NonNullable<Awaited<ReturnType<typeof getInvoiceForPrint>>>

/**
 * Everything a receipt prints. `membership_id` and `invoice_id` are nullable on
 * payments (`on delete set null`), so both embeds can be absent and the receipt
 * has to read without them.
 */
export async function getPaymentForPrint(paymentId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('payments')
    .select(
      `
      *,
      collector:staff!payments_collected_by_fkey(full_name),
      member:members!payments_member_fkey(${MEMBER_FIELDS}),
      membership:memberships!payments_membership_fkey(
        plan_name, plan_type, start_date, end_date, signup_fee_waived_paisa
      ),
      invoice:invoices!payments_invoice_fkey(
        invoice_no, total_paisa, paid_paisa, due_paisa, status,
        discount_paisa, discount_reason, discount_note
      ),
      branch:branches!payments_branch_fkey(${BRANCH_FIELDS}),
      org:orgs!payments_org_id_fkey(${ORG_LETTERHEAD})
    `
    )
    .eq('id', paymentId)
    .maybeSingle()

  if (error) throw error
  return data
}

export type PaymentForPrint = NonNullable<Awaited<ReturnType<typeof getPaymentForPrint>>>
