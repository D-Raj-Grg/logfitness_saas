import { BalanceBlock } from '@/components/print/balance-block'
import { DocumentFooter } from '@/components/print/document-footer'
import { DocumentMeta } from '@/components/print/document-meta'
import { Letterhead } from '@/components/print/letterhead'
import {
  LineItemsTable,
  docTable,
  type TotalRow,
} from '@/components/print/line-items-table'
import { SavingsBanner, type SavingsItem } from '@/components/print/savings-banner'
import type { InvoiceForPrint } from '@/lib/db/documents'
import { orgFormatters } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '@/lib/members'
import { invoiceLines } from '@/lib/print/line-items'
import { discountLabel, documentStrings } from '@/lib/print/strings'

export function InvoiceDocument({ invoice }: { invoice: InvoiceForPrint }) {
  const fmt = orgFormatters(invoice.org)
  const t = documentStrings()
  const lines = invoiceLines(invoice)
  // The totals row stays the plain word: it is arithmetic, and "Owner's
  // cousin - NPR 300" on the subtotal line reads as a mistake. The reason
  // belongs in the banner, where it is the point.
  const discountName = discountLabel(
    invoice.discount_reason,
    invoice.discount_note
  )

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
    { label: t.subtotal, value: fmt.money(invoice.subtotal_paisa) },
    ...(invoice.discount_paisa > 0
      ? [{ label: t.discount, value: `- ${fmt.money(invoice.discount_paisa)}` }]
      : []),
    { label: t.total, value: fmt.money(invoice.total_paisa), tone: 'total' as const },
    ...(invoice.paid_paisa > 0
      ? [{ label: t.paid, value: fmt.money(invoice.paid_paisa) }]
      : []),
  ]

  // Both credits, one figure. The registration fee came off inside the
  // subtotal and the discount came off after it; the member should not have to
  // work that out to see what the sale saved them.
  const savings: SavingsItem[] = [
    {
      label: t.registrationFee,
      amountPaisa: invoice.membership?.signup_fee_waived_paisa ?? 0,
    },
    { label: discountName, amountPaisa: invoice.discount_paisa },
  ]

  return (
    <>
      <Letterhead org={invoice.org} documentTitle={t.invoiceTitle} />

      <DocumentMeta
        member={invoice.member}
        branch={invoice.branch}
        factsLabel={t.invoiceTitle}
        entries={[
          { label: t.invoiceNo, value: invoice.invoice_no },
          { label: t.issued, value: fmt.date(invoice.issued_on) },
          ...(invoice.membership?.seller
            ? [{ label: t.soldBy, value: invoice.membership.seller.full_name }]
            : []),
        ]}
      />

      <LineItemsTable lines={lines} totals={totals} formatAmount={fmt.money} />

      <SavingsBanner items={savings} formatAmount={fmt.money} />

      <BalanceBlock duePaisa={due} formatAmount={fmt.money} />

      {payments.length > 0 ? (
        <section className="avoid-break mt-[9mm]">
          <p className="text-[8pt] font-medium uppercase tracking-[0.12em] text-[color:var(--muted)]">
            {t.paymentsReceived}
          </p>

          <table className="mt-[2mm] w-full border-collapse">
            <thead>
              <tr className={docTable.headRow}>
                <th className={`${docTable.head} text-left`}>{t.date}</th>
                <th className={`${docTable.head} text-left`}>{t.method}</th>
                <th className={`${docTable.head} text-left`}>{t.reference}</th>
                <th className={`${docTable.head} text-left`}>{t.receivedBy}</th>
                <th className={`${docTable.head} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className={docTable.row}>
                  <td className={docTable.cell}>{fmt.date(payment.paid_at)}</td>
                  <td className={docTable.cell}>
                    {PAYMENT_METHOD_LABELS[payment.method]}
                    {payment.kind === 'refund' ? ` · ${t.refundSuffix}` : ''}
                    {payment.kind === 'reversal' ? ` · ${t.reversalSuffix}` : ''}
                  </td>
                  <td className={docTable.cellMuted}>{payment.reference_no ?? '—'}</td>
                  <td className={docTable.cellMuted}>
                    {payment.collector?.full_name ?? '—'}
                  </td>
                  <td className={docTable.amount}>{fmt.money(payment.amount_paisa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {paymentsHidden ? (
        <p className="mt-[6mm] text-[9pt] text-[color:var(--muted)]">
          {t.paymentsLimitedToBranch}
        </p>
      ) : null}

      {invoice.notes ? (
        <p className="avoid-break mt-[6mm] whitespace-pre-line text-[9pt] text-[color:var(--muted)]">
          {invoice.notes}
        </p>
      ) : null}

      <DocumentFooter org={invoice.org} />
    </>
  )
}
