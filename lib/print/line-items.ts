import type { InvoiceForPrint } from '@/lib/db/documents'
import { orgFormatters } from '@/lib/format'
import { documentStrings } from '@/lib/print/strings'

/**
 * An invoice has no line-items table: it is one membership sale, and the only
 * split that exists is the registration fee.
 *
 * Before 20260906120100_membership_signup_fee.sql, renew_membership() folded
 * the fee into memberships.price_paisa and invoices.subtotal_paisa and stored
 * it nowhere else. Those rows carry signup_fee_paisa = 0 and correctly print as
 * a single line. Do not try to recover the split for them from
 * membership_plans.signup_fee_paisa -- the plan may have been repriced since,
 * and a wrong number on a tax document is worse than a missing one.
 *
 * A fee that applied and was not charged (20260910120000_waived_signup_fee.sql)
 * prints as a pair: the fee, then the same amount back off with a minus. That
 * is the gym owner's call, and it is the right one -- the member sees the money
 * come off the way a discount comes off, instead of reading an accounting term.
 * The word "waived" appears in the column name and in these comments; it never
 * appears on paper.
 *
 * The pair nets to zero, so the body lines still sum to invoices.subtotal_paisa.
 * The discount is applied after the subtotal, so it stays in the totals block --
 * that split is what `invoices_total_is_net` means. The savings banner is what
 * puts the two back together for the reader.
 */
export type DocumentLine = {
  description: string
  detail: string | null
  amountPaisa: number
}

export function invoiceLines(invoice: InvoiceForPrint): DocumentLine[] {
  const fmt = orgFormatters(invoice.org)
  const t = documentStrings()
  const membership = invoice.membership
  const signupFee = membership?.signup_fee_paisa ?? 0
  const feeOff = membership?.signup_fee_waived_paisa ?? 0

  const detail = !membership
    ? null
    : membership.plan_type === 'session_pack'
      ? [
          membership.sessions_total ? t.sessions(membership.sessions_total) : null,
          membership.end_date ? t.validTo(fmt.date(membership.end_date)) : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : `${fmt.date(membership.start_date)} – ${
          membership.end_date ? fmt.date(membership.end_date) : t.openEnded
        }`

  const lines: DocumentLine[] = [
    {
      description: membership?.plan_name ?? t.membershipDues,
      detail: detail || null,
      amountPaisa: invoice.subtotal_paisa - signupFee,
    },
  ]

  if (signupFee > 0) {
    lines.push({
      description: t.registrationFee,
      detail: null,
      amountPaisa: signupFee,
    })
  }

  if (feeOff > 0) {
    lines.push(
      {
        description: t.registrationFee,
        detail: null,
        amountPaisa: feeOff,
      },
      {
        description: t.registrationFeeOff,
        // Why it came off, read off the data rather than guessed: a membership
        // that follows another is a renewal, and the member paid the fee then.
        // Anything else is a plan whose price already covers it.
        detail: membership?.previous_membership_id
          ? t.alreadyPaidOnJoining
          : t.coveredByPlan,
        amountPaisa: -feeOff,
      }
    )
  }

  return lines
}
