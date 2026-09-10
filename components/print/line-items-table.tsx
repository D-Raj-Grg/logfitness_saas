import type { DocumentLine } from '@/lib/print/line-items'

export type TotalRow = { label: string; value: string; emphasis?: boolean }

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
    <table className="mt-6 w-full border-collapse text-[9.5pt]">
      <thead>
        <tr className="border-y border-[#d4d4d4]">
          <th className="py-2 text-left font-medium uppercase tracking-wide text-[#6b7280]">
            Description
          </th>
          <th className="py-2 text-right font-medium uppercase tracking-wide text-[#6b7280]">
            Amount
          </th>
        </tr>
      </thead>

      <tbody>
        {lines.map((line, index) => (
          <tr key={`${line.description}-${index}`} className="border-b border-[#ededed]">
            <td className="py-2.5 pr-6 align-top">
              <span className="font-medium text-[#111827]">{line.description}</span>
              {line.detail ? (
                <span className="block text-[9pt] text-[#6b7280]">{line.detail}</span>
              ) : null}
            </td>
            <td className="py-2.5 text-right align-top tabular-nums text-[#111827]">
              {/* A credit reads as "- NPR 500", not "NPR -500" -- the same
                  shape the Discount total uses. */}
              {line.amountPaisa < 0
                ? `- ${formatAmount(Math.abs(line.amountPaisa))}`
                : formatAmount(line.amountPaisa)}
            </td>
          </tr>
        ))}
      </tbody>

      <tfoot>
        {totals.map((total) => (
          <tr key={total.label}>
            <td
              className={
                total.emphasis
                  ? 'py-1.5 pr-6 text-right text-[10.5pt] font-semibold text-[#111827]'
                  : 'py-1 pr-6 text-right text-[#6b7280]'
              }
            >
              {total.label}
            </td>
            <td
              className={
                total.emphasis
                  ? 'py-1.5 text-right text-[10.5pt] font-semibold tabular-nums text-[#111827]'
                  : 'py-1 text-right tabular-nums text-[#111827]'
              }
            >
              {total.value}
            </td>
          </tr>
        ))}
      </tfoot>
    </table>
  )
}
