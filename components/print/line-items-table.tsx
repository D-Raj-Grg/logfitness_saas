import type { DocumentLine } from '@/lib/print/line-items'

export type TotalRow = {
  label: string
  value: string
  /**
   * 'total' is the one the eye should land on, and it is the only row set
   * above body size. Everything else is a supporting figure.
   */
  tone?: 'quiet' | 'total'
}

/**
 * Shared cell classes. The invoice prints a second table for its payment
 * history, and before these were exported it carried its own copy of the
 * styling -- which is how two tables on one sheet drift apart. Anything that
 * prints rows of figures imports these.
 */
export const docTable = {
  head: 'py-[2mm] text-[8pt] font-medium uppercase tracking-[0.08em] text-[color:var(--muted)]',
  headRow: 'border-b border-[color:var(--rule)]',
  row: 'border-b border-[color:var(--hairline)]',
  cell: 'py-[2.2mm] align-top text-[10pt] text-[color:var(--ink)]',
  cellMuted: 'py-[2.2mm] align-top text-[9pt] text-[color:var(--muted)]',
  amount: 'py-[2.2mm] text-right align-top text-[10pt] tabular-nums text-[color:var(--ink)]',
} as const

/** A credit reads as "- NPR 500", never "NPR -500". */
export function signedAmount(paisa: number, format: (paisa: number) => string) {
  return paisa < 0 ? `- ${format(Math.abs(paisa))}` : format(paisa)
}

/**
 * A plain semantic table -- no shadcn/Base UI here. Anything portal-backed
 * mounts outside the sheet and prints as stray content or a trailing blank
 * page. The totals sit in a <tfoot> so they repeat if a document runs long.
 */
export function LineItemsTable({
  lines,
  totals,
  formatAmount,
}: {
  lines: DocumentLine[]
  totals: TotalRow[]
  formatAmount: (paisa: number) => string
}) {
  return (
    <table className="mt-[8mm] w-full border-collapse">
      <thead>
        <tr className={docTable.headRow}>
          <th className={`${docTable.head} text-left`}>Description</th>
          <th className={`${docTable.head} text-right`}>Amount</th>
        </tr>
      </thead>

      <tbody>
        {lines.map((line, index) => (
          <tr key={`${line.description}-${index}`} className={docTable.row}>
            <td className={`${docTable.cell} pr-6`}>
              <span className="font-medium">{line.description}</span>
              {line.detail ? (
                <span className="mt-[0.6mm] block text-[9pt] font-normal text-[color:var(--muted)]">
                  {line.detail}
                </span>
              ) : null}
            </td>
            <td className={docTable.amount}>
              {signedAmount(line.amountPaisa, formatAmount)}
            </td>
          </tr>
        ))}
      </tbody>

      <tfoot>
        {totals.map((total) => (
          <tr key={total.label}>
            {total.tone === 'total' ? (
              <>
                <td className="border-t border-[color:var(--rule)] pt-[2.5mm] pr-6 text-right text-[10pt] font-semibold uppercase tracking-[0.08em]">
                  {total.label}
                </td>
                <td className="border-t border-[color:var(--rule)] pt-[2.5mm] text-right text-[13pt] font-semibold tabular-nums">
                  {total.value}
                </td>
              </>
            ) : (
              <>
                <td className="py-[0.8mm] pr-6 text-right text-[9.5pt] text-[color:var(--muted)]">
                  {total.label}
                </td>
                <td className="py-[0.8mm] text-right text-[9.5pt] tabular-nums">
                  {total.value}
                </td>
              </>
            )}
          </tr>
        ))}
      </tfoot>
    </table>
  )
}
