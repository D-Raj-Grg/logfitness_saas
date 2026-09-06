import { DocumentFooter } from '@/components/print/document-footer'
import { DocumentMeta } from '@/components/print/document-meta'
import { Letterhead } from '@/components/print/letterhead'
import { LineItemsTable, type TotalRow } from '@/components/print/line-items-table'
import type { InvoiceForPrint } from '@/lib/db/documents'
import { orgFormatters } from '@/lib/format'
import { INVOICE_STATUS_LABELS, PAYMENT_METHOD_LABELS } from '@/lib/members'
import { invoiceLines } from '@/lib/print/line-items'

export function InvoiceDocument({ invoice }: { invoice: InvoiceForPrint }) {
  const fmt = orgFormatters(invoice.org)
  const lines = invoiceLines(invoice)

  const payments = [...invoice.payments].sort((a, b) => a.paid_at.localeCompare(b.paid_at))

  // payments has a branch-scoped select policy, so a manager outside the
  // selling branch sees none of them. paid_paisa is trigger-maintained on the
  // invoice and is right regardless -- say why the list is empty rather than
  // letting it read as "never paid".
  const paymentsHidden = payments.length === 0 && invoice.paid_paisa > 0

  // due_paisa is a generated column, so the type is nullable even though the
  // database always has it. Same fallback the invoices tab uses.
  const due = invoice.due_paisa ?? Math.max(0, invoice.total_paisa - invoice.paid_paisa)

  const totals: TotalRow[] = [
    { label: 'Subtotal', value: fmt.money(invoice.subtotal_paisa) },
    ...(invoice.discount_paisa > 0
      ? [{ label: 'Discount', value: `- ${fmt.money(invoice.discount_paisa)}` }]
      : []),
    { label: 'Total', value: fmt.money(invoice.total_paisa), emphasis: true },
    { label: 'Paid', value: fmt.money(invoice.paid_paisa) },
    {
      label: 'Balance due',
      value: fmt.money(due),
      emphasis: due > 0,
    },
  ]

  return (
    <>
      <Letterhead org={invoice.org} documentTitle="Invoice" />

      <DocumentMeta
        member={invoice.member}
        branch={invoice.branch}
        entries={[
          { label: 'Invoice no.', value: invoice.invoice_no },
          { label: 'Issued', value: fmt.date(invoice.issued_on) },
          { label: 'Status', value: INVOICE_STATUS_LABELS[invoice.status] },
          ...(invoice.membership?.seller
            ? [{ label: 'Sold by', value: invoice.membership.seller.full_name }]
            : []),
        ]}
      />

      <LineItemsTable lines={lines} totals={totals} formatAmount={fmt.money} />

      {payments.length > 0 ? (
        <section className="avoid-break mt-8">
          <p className="text-[8.5pt] font-medium uppercase tracking-wide text-[#6b7280]">
            Payments received
          </p>

          <table className="mt-2 w-full border-collapse text-[9pt]">
            <thead>
              <tr className="border-b border-[#d4d4d4] text-[#6b7280]">
                <th className="py-1.5 text-left font-medium">Date</th>
                <th className="py-1.5 text-left font-medium">Method</th>
                <th className="py-1.5 text-left font-medium">Reference</th>
                <th className="py-1.5 text-left font-medium">Received by</th>
                <th className="py-1.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-b border-[#ededed]">
                  <td className="py-1.5 text-[#111827]">{fmt.date(payment.paid_at)}</td>
                  <td className="py-1.5 text-[#111827]">
                    {PAYMENT_METHOD_LABELS[payment.method]}
                    {payment.kind === 'refund' ? ' · refund' : ''}
                  </td>
                  <td className="py-1.5 text-[#4b5563]">{payment.reference_no ?? '—'}</td>
                  <td className="py-1.5 text-[#4b5563]">
                    {payment.collector?.full_name ?? '—'}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-[#111827]">
                    {fmt.money(payment.amount_paisa)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {paymentsHidden ? (
        <p className="mt-6 text-[9pt] text-[#6b7280]">
          Payment details are limited to your branch. The totals above are complete.
        </p>
      ) : null}

      {invoice.notes ? (
        <p className="avoid-break mt-6 whitespace-pre-line text-[9pt] text-[#4b5563]">
          {invoice.notes}
        </p>
      ) : null}

      <DocumentFooter org={invoice.org} />
    </>
  )
}
