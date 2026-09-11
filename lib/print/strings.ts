/**
 * Every word a member reads on a printed document, in one place.
 *
 * Nepali is a stated follow-up, not a v1 feature, so there is no i18n library
 * and no locale column yet -- `documentStrings()` always answers 'en'. What
 * this file buys today is that adding Nepali later is a second entry in the
 * record and a font, not an archaeology dig through six components.
 *
 * Two conventions are borrowed rather than invented: the shape is the same
 * `Record<Enum, string>` the console already uses for its labels (lib/members.ts),
 * and the locale codes are the ones the notification templates already check
 * against ('en' | 'ne', 20260909140000_notification_schema.sql).
 *
 * When Nepali lands it needs a Devanagari face -- Figtree has none.
 *
 * House rules for anything added here:
 *   - Say the amount, never soften it. "Balance due", not "outstanding".
 *   - No accounting words a member would have to ask about. The gym owner's
 *     verdict on the previous copy was "waived -- some customer doesn't
 *     understand", and he was right.
 *   - Sentence case for prose, upper case only where the design uses a label
 *     as a graphic element.
 */

import { DISCOUNT_REASON_LABELS, type DiscountReason } from '@/lib/members'

export type DocumentLocale = 'en' | 'ne'

export type DocumentStrings = {
  // Document titles, printed at the top right of the sheet.
  invoiceTitle: string
  receiptTitle: string
  refundTitle: string
  correctionTitle: string

  // The meta band.
  billedTo: string
  issuedAt: string
  invoiceNo: string
  receiptNo: string
  issued: string
  date: string
  soldBy: string
  method: string
  reference: string
  receivedBy: string
  refundedBy: string
  correctedBy: string

  // Line items.
  description: string
  amount: string
  membershipDues: string
  openEnded: string
  validTo: (date: string) => string
  sessions: (count: number) => string

  /**
   * The registration fee, and the same amount coming back off. Two lines, with
   * a minus, deliberately: the owner asked for it to read the way a discount
   * reads -- "let user see yes the registration off" -- rather than as a single
   * line the member has to interpret.
   */
  registrationFee: string
  registrationFeeOff: string
  /** Why it came off: a renewal already paid it. */
  alreadyPaidOnJoining: string
  /** Why it came off: the plan price covers it. */
  coveredByPlan: string

  // Totals.
  subtotal: string
  discount: string
  total: string
  paid: string
  balanceDue: string
  paidInFull: string
  creditBalance: string

  // The savings banner.
  youSaved: string

  // Receipt.
  amountReceived: string
  amountRefunded: string
  amountReversed: string
  towards: string
  againstInvoice: string
  invoiceTotal: string
  paidToDate: string
  reason: string

  // Invoice payment history.
  paymentsReceived: string
  paymentsLimitedToBranch: string
  refundSuffix: string
  reversalSuffix: string

  // Footer.
  computerGenerated: string
  authorisedSignature: string
}

const en: DocumentStrings = {
  invoiceTitle: 'Invoice',
  receiptTitle: 'Payment receipt',
  refundTitle: 'Refund receipt',
  correctionTitle: 'Payment correction',

  billedTo: 'Billed to',
  issuedAt: 'Issued at',
  invoiceNo: 'Invoice no.',
  receiptNo: 'Receipt no.',
  issued: 'Issued',
  date: 'Date',
  soldBy: 'Sold by',
  method: 'Method',
  reference: 'Reference',
  receivedBy: 'Received by',
  refundedBy: 'Refunded by',
  correctedBy: 'Corrected by',

  description: 'Description',
  amount: 'Amount',
  membershipDues: 'Membership dues',
  openEnded: 'open ended',
  validTo: (date) => `valid to ${date}`,
  sessions: (count) => `${count} sessions`,

  registrationFee: 'Registration fee',
  registrationFeeOff: 'Registration fee off',
  alreadyPaidOnJoining: 'You paid this when you joined',
  coveredByPlan: 'Included in this plan price',

  subtotal: 'Subtotal',
  discount: 'Discount',
  total: 'Total',
  paid: 'Paid',
  balanceDue: 'Balance due',
  paidInFull: 'Paid in full',
  creditBalance: 'Credit balance',

  youSaved: 'You saved',

  amountReceived: 'Amount received',
  amountRefunded: 'Amount refunded',
  amountReversed: 'Amount reversed — never received',
  towards: 'Towards',
  againstInvoice: 'Against invoice',
  invoiceTotal: 'Invoice total',
  paidToDate: 'Paid to date',
  reason: 'Reason',

  paymentsReceived: 'Payments received',
  paymentsLimitedToBranch:
    'Payment details are limited to your branch. The totals above are complete.',
  refundSuffix: 'refund',
  reversalSuffix: 'correction',

  computerGenerated: 'Computer generated. Valid without a stamp.',
  authorisedSignature: 'Authorised signature',
}

const DOCUMENT_STRINGS: Record<DocumentLocale, DocumentStrings> = {
  en,
  // Nepali is not written yet. Falling back to English is the honest answer --
  // half-translated money is worse than none.
  ne: en,
}

export function documentStrings(locale: DocumentLocale = 'en'): DocumentStrings {
  return DOCUMENT_STRINGS[locale] ?? en
}

/**
 * What to call a discount on paper. The chosen reason, or what the desk typed
 * when they chose "Other". Falls back to the bare word for the discounts sold
 * before reasons were captured -- those rows are history and carry none.
 */
export function discountLabel(
  reason: DiscountReason | null | undefined,
  note: string | null | undefined,
  locale: DocumentLocale = 'en'
) {
  const t = documentStrings(locale)
  if (!reason) return t.discount
  if (reason === 'other') return note?.trim() || t.discount
  return DISCOUNT_REASON_LABELS[reason]
}
