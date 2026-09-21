import type { discountReport } from '@/lib/db/reports'
import { formatMoney } from '@/lib/format'
import { DISCOUNT_REASON_LABELS } from '@/lib/members'

type Row = Awaited<ReturnType<typeof discountReport>>[number]

/**
 * What was given away today, and why.
 *
 * A strip rather than a sixth tile: a discount total with no reasons beside it
 * is the number that starts an argument, and the reasons are the answer to the
 * question the total provokes. Hidden entirely on the days there were none,
 * because this sheet gets printed and an empty section is just noise on paper.
 */
export function CollectionDiscounts({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return null

  const total = rows.reduce((sum, row) => sum + row.discount_paisa, 0)

  // Several branches can discount for the same reason; the strip is about the
  // reasons, so they are summed across whatever branches are in scope.
  const byReason = new Map<string, number>()
  for (const row of rows) {
    const label = row.reason ? DISCOUNT_REASON_LABELS[row.reason] : 'Not recorded'
    byReason.set(label, (byReason.get(label) ?? 0) + row.discount_paisa)
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-dashed px-4 py-3 avoid-break">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Discount given
      </span>
      <span className="font-semibold tabular-nums">{formatMoney(total)}</span>
      <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {[...byReason.entries()].map(([label, paisa]) => (
          <span key={label} className="tabular-nums">
            {label} {formatMoney(paisa)}
          </span>
        ))}
      </span>
    </div>
  )
}
