import { StatTile } from '@/components/app/stat-tile'
import { CollectionDelta } from '@/components/payments/collection-delta'
import type { dailyCollectionSummary } from '@/lib/db/payments'
import { formatDate, formatMoney } from '@/lib/format'

type SummaryRow = Awaited<ReturnType<typeof dailyCollectionSummary>>[number]

/**
 * The five numbers a shift is handed over on.
 *
 * Five, not ten: the summary RPC returns eighteen columns and a strip that
 * shows all of them is a strip nobody reads. Everything else earns its place as
 * a hint under the figure it qualifies, so the tile still answers one question
 * and the supporting number is a glance away rather than a row away.
 *
 * Both arguments are the totals rows -- the ones with a null branch_id.
 */
export function CollectionSummary({
  summary,
  previous,
  on,
}: {
  summary: SummaryRow
  previous: SummaryRow | null
  on: string
}) {
  const returned = summary.refunds_paisa + summary.reversals_paisa
  const previousReturned = previous
    ? previous.refunds_paisa + previous.reversals_paisa
    : 0

  const delta = (current: number, prior: number, kind?: 'money' | 'count') =>
    previous ? <CollectionDelta current={current} previous={prior} kind={kind} /> : null

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {formatDate(on)}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 print:grid-cols-5">
        <StatTile
          label="Net collected"
          value={formatMoney(summary.net_paisa)}
          hint={`${summary.payment_count} payment${summary.payment_count === 1 ? '' : 's'} · gross ${formatMoney(summary.gross_paisa)}`}
          footer={delta(summary.net_paisa, previous?.net_paisa ?? 0)}
        />

        <StatTile
          label="Refunded / reversed"
          value={formatMoney(returned)}
          className={returned > 0 ? 'text-destructive' : undefined}
          hint={`${summary.refund_count} refunded · ${summary.reversal_count} never arrived`}
          footer={delta(returned, previousReturned)}
        />

        {/* The number counted at close. Its hint carries digital so that
            cash + digital = net stays checkable by eye. */}
        <StatTile
          label="In the drawer"
          value={formatMoney(summary.cash_paisa)}
          hint={`digital ${formatMoney(summary.digital_paisa)}`}
          footer={delta(summary.cash_paisa, previous?.cash_paisa ?? 0)}
        />

        <StatTile
          label="Members who paid"
          value={String(summary.distinct_payers)}
          hint={`${summary.invoice_count} invoice${summary.invoice_count === 1 ? '' : 's'} raised`}
          footer={delta(summary.distinct_payers, previous?.distinct_payers ?? 0, 'count')}
        />

        {/* Billed is not collected. The shortfall is the dues this day created,
            which is tomorrow's chasing, so it is the hint that gets the colour. */}
        <StatTile
          label="Billed today"
          value={formatMoney(summary.billed_paisa)}
          hint={
            summary.billed_due_paisa > 0 ? (
              <span className="text-destructive">
                {formatMoney(summary.billed_due_paisa)} still owed
              </span>
            ) : (
              'all settled'
            )
          }
          footer={delta(summary.billed_paisa, previous?.billed_paisa ?? 0)}
        />
      </div>

      {/* Paper only. Without it the shift lead writes these four things in the
          margin in biro, which is how a variance stops being traceable. */}
      <div className="hidden print:flex print:flex-wrap print:gap-x-8 print:gap-y-2 print:border-t print:pt-3 print:text-xs">
        <span>Counted by ________________</span>
        <span>Handed to ________________</span>
        <span>Cash counted ________________</span>
        <span>Variance ________________</span>
      </div>
    </div>
  )
}
