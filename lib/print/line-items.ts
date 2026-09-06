import type { InvoiceForPrint } from '@/lib/db/documents'
import { orgFormatters } from '@/lib/format'

/**
 * An invoice has no line-items table: it is one membership sale, and the only
 * split that exists is the joining fee.
 *
 * Before 20260906120100_membership_signup_fee.sql, renew_membership() folded
 * the fee into memberships.price_paisa and invoices.subtotal_paisa and stored
 * it nowhere else. Those rows carry signup_fee_paisa = 0 and correctly print as
 * a single line. Do not try to recover the split for them from
 * membership_plans.signup_fee_paisa -- the plan may have been repriced since,
 * and a wrong number on a tax document is worse than a missing one.
 */
export type DocumentLine = {
  description: string
  detail: string | null
  amountPaisa: number
}

export function invoiceLines(invoice: InvoiceForPrint): DocumentLine[] {
  const fmt = orgFormatters(invoice.org)
  const membership = invoice.membership
  const signupFee = membership?.signup_fee_paisa ?? 0

  const detail = !membership
    ? null
    : membership.plan_type === 'session_pack'
      ? [
          membership.sessions_total ? `${membership.sessions_total} sessions` : null,
          membership.end_date ? `valid to ${fmt.date(membership.end_date)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : `${fmt.date(membership.start_date)} – ${
          membership.end_date ? fmt.date(membership.end_date) : 'open ended'
        }`

  const lines: DocumentLine[] = [
    {
      description: membership?.plan_name ?? 'Membership dues',
      detail: detail || null,
      amountPaisa: invoice.subtotal_paisa - signupFee,
    },
  ]

  if (signupFee > 0) {
    lines.push({
      description: 'Joining fee',
      detail: 'Charged once, on the first membership',
      amountPaisa: signupFee,
    })
  }

  return lines
}
