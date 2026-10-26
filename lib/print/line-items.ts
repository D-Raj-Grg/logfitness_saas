import type { InvoiceForPrint } from '@/lib/db/documents'
import { orgFormatters } from '@/lib/format'
import { documentStrings } from '@/lib/print/strings'

/**
 * An invoice has no line-items table: it is one membership sale, and its fee
 * lines are read off what the sale recorded.
 *
 * Two shapes exist, and both must keep printing:
 *
 *  - Catalogue sales (20261027100000_fee_catalogue.sql) write one
 *    `membership_fees` row per fee the plan carried: what it charged and what it
 *    took back off. Those rows ARE the fee lines.
 *  - Older sales have no such rows. Before 20260906120100 renew_membership()
 *    folded the one joining fee into memberships.price_paisa and stored it
 *    nowhere else; after it, the fee lived in signup_fee_paisa and the waived
 *    memo in signup_fee_waived_paisa. Those columns still print as a single
 *    "Registration fee". Do not try to recover a split for a row that carries
 *    none from membership_plans or from the fees catalogue -- the price may have
 *    changed since, and a wrong number on a tax document is worse than a
 *    missing one.
 *
 * A fee that applied and was not charged prints as a pair: the fee, then the
 * same amount back off with a minus. That is the gym owner's call, and it is
 * the right one -- the member sees the money come off the way a discount comes
 * off, instead of reading an accounting term. The word "waived" appears in
 * column names and comments; it never appears on paper.
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

/** One fee of one printed sale, whichever way it was recorded. */
export type PrintFee = {
  name: string
  chargedPaisa: number
  waivedPaisa: number
  /** Why a taken-back-off fee came off, or null when nothing is waived. */
  offReason: string | null
}

/**
 * What the fee lines need of a membership. Structural, because the invoice
 * query and the receipt query select different columns: a receipt carries the
 * recorded fees and the legacy waived memo, but not the charged legacy fee.
 */
type PrintableMembership = {
  fees?: {
    name: string
    charge_rule: string
    charged_paisa: number
    waived_paisa: number
    sort_order: number
  }[] | null
  signup_fee_paisa?: number | null
  signup_fee_waived_paisa?: number | null
  previous_membership_id?: string | null
}

/**
 * The fees of one sale, in print order. Catalogue rows when the sale has them,
 * otherwise the legacy joining fee columns. Empty for a sale that had no fee.
 */
export function printFees(membership: PrintableMembership | null | undefined): PrintFee[] {
  if (!membership) return []
  const t = documentStrings()

  const recorded = [...(membership.fees ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  if (recorded.length > 0) {
    return recorded.map((fee) => ({
      name: fee.name,
      chargedPaisa: fee.charged_paisa,
      waivedPaisa: fee.waived_paisa,
      offReason: fee.waived_paisa > 0 ? t.onlyOnFirstMembership : null,
    }))
  }

  const charged = membership.signup_fee_paisa ?? 0
  const waived = membership.signup_fee_waived_paisa ?? 0
  if (charged === 0 && waived === 0) return []

  return [
    {
      name: t.registrationFee,
      chargedPaisa: charged,
      waivedPaisa: waived,
      // Read off the data rather than guessed: a membership that follows
      // another is a renewal, and the member paid the fee then. Anything else
      // is a plan whose price already covers it.
      offReason:
        waived > 0
          ? membership.previous_membership_id
            ? t.alreadyPaidOnJoining
            : t.coveredByPlan
          : null,
    },
  ]
}

/** What the sale saved the member in fees, one item per fee, for the banner. */
export function feeSavings(membership: PrintableMembership | null | undefined) {
  return printFees(membership).map((fee) => ({
    label: fee.name,
    amountPaisa: fee.waivedPaisa,
  }))
}

export function invoiceLines(invoice: InvoiceForPrint): DocumentLine[] {
  const fmt = orgFormatters(invoice.org)
  const t = documentStrings()
  const membership = invoice.membership
  const fees = printFees(membership)
  const feesCharged = fees.reduce((sum, fee) => sum + fee.chargedPaisa, 0)

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
      amountPaisa: invoice.subtotal_paisa - feesCharged,
    },
  ]

  for (const fee of fees) {
    if (fee.chargedPaisa > 0) {
      lines.push({ description: fee.name, detail: null, amountPaisa: fee.chargedPaisa })
    }

    if (fee.waivedPaisa > 0) {
      lines.push(
        { description: fee.name, detail: null, amountPaisa: fee.waivedPaisa },
        {
          description: t.feeOff(fee.name),
          detail: fee.offReason,
          amountPaisa: -fee.waivedPaisa,
        }
      )
    }
  }

  return lines
}
