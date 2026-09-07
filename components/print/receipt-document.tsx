import { DocumentFooter } from '@/components/print/document-footer'
import { DocumentMeta } from '@/components/print/document-meta'
import { Letterhead } from '@/components/print/letterhead'
import type { PaymentForPrint } from '@/lib/db/documents'
import { orgFormatters } from '@/lib/format'
import { INVOICE_STATUS_LABELS, PAYMENT_METHOD_LABELS } from '@/lib/members'

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
  const isRefund = payment.kind === 'refund'
  const isReversal = payment.kind === 'reversal'
  const amount = Math.abs(payment.amount_paisa)

  return (
    <>
      <Letterhead
        org={payment.org}
        documentTitle={
          isReversal
            ? 'Payment correction'
            : isRefund
              ? 'Refund receipt'
              : 'Payment receipt'
        }
      />

      <DocumentMeta
        member={payment.member}
        branch={payment.branch}
        entries={[
          { label: 'Receipt no.', value: payment.id.slice(0, 8).toUpperCase() },
          { label: 'Date', value: fmt.dateTime(payment.paid_at) },
          { label: 'Method', value: PAYMENT_METHOD_LABELS[payment.method] },
          ...(payment.reference_no
            ? [{ label: 'Reference', value: payment.reference_no }]
            : []),
          ...(payment.collector
            ? [
                {
                  label: isReversal
                    ? 'Corrected by'
                    : isRefund
                      ? 'Refunded by'
                      : 'Received by',
                  value: payment.collector.full_name,
                },
              ]
            : []),
        ]}
      />

      <section className="avoid-break mt-8 border-y border-[#d4d4d4] py-4">
        <p className="text-[8.5pt] font-medium uppercase tracking-wide text-[#6b7280]">
          {isReversal
            ? 'Amount reversed -- never received'
            : isRefund
              ? 'Amount refunded'
              : 'Amount received'}
        </p>
        <p className="mt-1 text-[20pt] font-semibold leading-none tabular-nums text-[#111827]">
          {fmt.money(amount)}
        </p>
        {payment.membership ? (
          <p className="mt-2 text-[9.5pt] text-[#4b5563]">
            Towards {payment.membership.plan_name}
            {payment.membership.end_date
              ? ` · ${fmt.date(payment.membership.start_date)} – ${fmt.date(
                  payment.membership.end_date
                )}`
              : ''}
          </p>
        ) : null}
      </section>

      {payment.invoice ? (
        <section className="avoid-break mt-6 space-y-1 text-[9.5pt]">
          <div className="flex justify-between gap-6">
            <span className="text-[#6b7280]">Against invoice</span>
            <span className="font-medium text-[#111827]">
              {payment.invoice.invoice_no}
            </span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-[#6b7280]">Invoice total</span>
            <span className="tabular-nums text-[#111827]">
              {fmt.money(payment.invoice.total_paisa)}
            </span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-[#6b7280]">Paid to date</span>
            <span className="tabular-nums text-[#111827]">
              {fmt.money(payment.invoice.paid_paisa)}
            </span>
          </div>
          <div className="flex justify-between gap-6 border-t border-[#e5e5e5] pt-1">
            <span className="font-medium text-[#111827]">Balance due</span>
            <span className="font-semibold tabular-nums text-[#111827]">
              {fmt.money(
                payment.invoice.due_paisa ??
                  Math.max(0, payment.invoice.total_paisa - payment.invoice.paid_paisa)
              )}{' '}
              ·{' '}
              {INVOICE_STATUS_LABELS[payment.invoice.status]}
            </span>
          </div>
        </section>
      ) : null}

      {payment.reason ? (
        <p className="avoid-break mt-6 text-[9pt] text-[#4b5563]">
          <span className="text-[#6b7280]">Reason: </span>
          {payment.reason}
        </p>
      ) : null}

      {payment.notes ? (
        <p className="avoid-break mt-2 whitespace-pre-line text-[9pt] text-[#4b5563]">
          {payment.notes}
        </p>
      ) : null}

      <DocumentFooter
        org={payment.org}
        signatureLabel={isRefund ? 'Authorised signature' : 'Received by'}
      />
    </>
  )
}
