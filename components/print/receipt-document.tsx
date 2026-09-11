import { DocumentFooter } from '@/components/print/document-footer'
import { DocumentMeta } from '@/components/print/document-meta'
import { Letterhead } from '@/components/print/letterhead'
import { SavingsBanner, type SavingsItem } from '@/components/print/savings-banner'
import type { PaymentForPrint } from '@/lib/db/documents'
import { orgFormatters } from '@/lib/format'
import { INVOICE_STATUS_LABELS, PAYMENT_METHOD_LABELS } from '@/lib/members'
import { discountLabel, documentStrings } from '@/lib/print/strings'

/**
 * A receipt is one payment row, not an invoice. Refunds and reversals are
 * negative payments, so the same document prints all three -- the heading and
 * the amount label switch, and the figure is shown unsigned with the direction
 * stated in words.
 *
 * A reversal is not a receipt for anything: nobody handed anything over. It
 * prints as a correction note so the member has the same piece of paper the
 * books do.
 */
export function ReceiptDocument({ payment }: { payment: PaymentForPrint }) {
  const fmt = orgFormatters(payment.org)
  const t = documentStrings()
  const isRefund = payment.kind === 'refund'
  const isReversal = payment.kind === 'reversal'
  const amount = Math.abs(payment.amount_paisa)
  const discountName = discountLabel(
    payment.invoice?.discount_reason,
    payment.invoice?.discount_note
  )

  const title = isReversal
    ? t.correctionTitle
    : isRefund
      ? t.refundTitle
      : t.receiptTitle

  // Only a payment is a sale. A refund or a correction is money going the
  // other way and has nothing to say about what the sale saved.
  const savings: SavingsItem[] =
    isRefund || isReversal
      ? []
      : [
          {
            label: t.registrationFee,
            amountPaisa: payment.membership?.signup_fee_waived_paisa ?? 0,
          },
          { label: discountName, amountPaisa: payment.invoice?.discount_paisa ?? 0 },
        ]

  return (
    <>
      <Letterhead org={payment.org} documentTitle={title} />

      <DocumentMeta
        member={payment.member}
        branch={payment.branch}
        factsLabel={title}
        entries={[
          { label: t.receiptNo, value: payment.id.slice(0, 8).toUpperCase() },
          { label: t.date, value: fmt.dateTime(payment.paid_at) },
          { label: t.method, value: PAYMENT_METHOD_LABELS[payment.method] },
          ...(payment.reference_no
            ? [{ label: t.reference, value: payment.reference_no }]
            : []),
          ...(payment.collector
            ? [
                {
                  label: isReversal
                    ? t.correctedBy
                    : isRefund
                      ? t.refundedBy
                      : t.receivedBy,
                  value: payment.collector.full_name,
                },
              ]
            : []),
        ]}
      />

      {/* The whole reason the member keeps this piece of paper. */}
      <section className="avoid-break mt-[9mm] flex items-end justify-between gap-8 border-b-2 border-[color:var(--ink)] pb-[3mm]">
        <div>
          <p className="text-[8pt] font-medium uppercase tracking-[0.14em] text-[color:var(--muted)]">
            {isReversal
              ? t.amountReversed
              : isRefund
                ? t.amountRefunded
                : t.amountReceived}
          </p>
          {payment.membership ? (
            <p className="mt-[2mm] text-[10pt] text-[color:var(--muted)]">
              {t.towards} {payment.membership.plan_name}
              {payment.membership.end_date
                ? ` · ${fmt.date(payment.membership.start_date)} – ${fmt.date(
                    payment.membership.end_date
                  )}`
                : ''}
            </p>
          ) : null}
        </div>

        <p className="shrink-0 text-[24pt] font-semibold leading-none tabular-nums">
          {fmt.money(amount)}
        </p>
      </section>

      <SavingsBanner items={savings} formatAmount={fmt.money} />

      {payment.invoice ? (
        <section className="avoid-break mt-[7mm] space-y-[1mm] text-[9.5pt]">
          <Row label={t.againstInvoice} value={payment.invoice.invoice_no} />
          {payment.invoice.discount_paisa > 0 ? (
            <Row
              label={t.discount}
              value={`- ${fmt.money(payment.invoice.discount_paisa)}`}
            />
          ) : null}
          <Row label={t.invoiceTotal} value={fmt.money(payment.invoice.total_paisa)} />
          <Row label={t.paidToDate} value={fmt.money(payment.invoice.paid_paisa)} />

          <div className="flex justify-between gap-6 border-t border-[color:var(--rule)] pt-[1.5mm]">
            <span className="font-medium">{t.balanceDue}</span>
            <span className="font-semibold tabular-nums">
              {fmt.money(
                payment.invoice.due_paisa ??
                  Math.max(0, payment.invoice.total_paisa - payment.invoice.paid_paisa)
              )}{' '}
              · {INVOICE_STATUS_LABELS[payment.invoice.status]}
            </span>
          </div>
        </section>
      ) : null}

      {payment.reason ? (
        <p className="avoid-break mt-[6mm] text-[9pt] text-[color:var(--muted)]">
          <span>{t.reason}: </span>
          {payment.reason}
        </p>
      ) : null}

      {payment.notes ? (
        <p className="avoid-break mt-[2mm] whitespace-pre-line text-[9pt] text-[color:var(--muted)]">
          {payment.notes}
        </p>
      ) : null}

      <DocumentFooter
        org={payment.org}
        // Nobody received a correction, and nobody signs for one as if they
        // had. Only a plain payment is signed "Received by".
        signatureLabel={isRefund || isReversal ? t.authorisedSignature : t.receivedBy}
      />
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6">
      <span className="text-[color:var(--muted)]">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
