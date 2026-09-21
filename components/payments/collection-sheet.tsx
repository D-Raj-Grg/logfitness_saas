import Link from 'next/link'

import { CollectionDiscounts } from '@/components/payments/collection-discounts'
import { CollectionMembers } from '@/components/payments/collection-members'
import { ExpandableCollector } from '@/components/payments/collection-rows'
import { CollectionSummary } from '@/components/payments/collection-summary'
import {
  Table,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type {
  dailyCollection,
  dailyCollectionDetail,
  dailyCollectionSummary,
} from '@/lib/db/payments'
import type { discountReport } from '@/lib/db/reports'
import { formatDate, formatMoney, formatTime } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '@/lib/members'
import { cn } from '@/lib/utils'

type Row = Awaited<ReturnType<typeof dailyCollection>>[number]
type Detail = Awaited<ReturnType<typeof dailyCollectionDetail>>[number]
type SummaryRow = Awaited<ReturnType<typeof dailyCollectionSummary>>[number]
type DiscountRow = Awaited<ReturnType<typeof discountReport>>[number]

type CollectorGroup = {
  staffId: string
  staffName: string
  rows: Row[]
  detail: Detail[]
  totalPaisa: number
  txnCount: number
}

type BranchGroup = {
  branchId: string
  branchName: string
  collectors: CollectorGroup[]
  totalPaisa: number
  txnCount: number
}

/**
 * Branch -> collector -> method/kind lines, with the individual payments
 * attached to the collector they belong to.
 *
 * daily_collection and daily_collection_detail share an ORDER BY, so the detail
 * lines arrive already in the order they are wanted and this stays one pass.
 */
function groupRows(rows: Row[], detail: Detail[]): BranchGroup[] {
  const branches = new Map<string, BranchGroup>()

  for (const row of rows) {
    let branch = branches.get(row.branch_id)
    if (!branch) {
      branch = {
        branchId: row.branch_id,
        branchName: row.branch_name,
        collectors: [],
        totalPaisa: 0,
        txnCount: 0,
      }
      branches.set(row.branch_id, branch)
    }

    let collector = branch.collectors.find((item) => item.staffId === row.staff_id)
    if (!collector) {
      collector = {
        staffId: row.staff_id,
        staffName: row.staff_name,
        rows: [],
        detail: [],
        totalPaisa: 0,
        txnCount: 0,
      }
      branch.collectors.push(collector)
    }

    collector.rows.push(row)
    collector.totalPaisa += row.amount_paisa
    collector.txnCount += row.txn_count
    branch.totalPaisa += row.amount_paisa
    branch.txnCount += row.txn_count
  }

  for (const line of detail) {
    const branch = branches.get(line.branch_id)
    if (!branch) continue
    const collector = branch.collectors.find((item) => item.staffId === line.staff_id)
    if (!collector) continue
    collector.detail.push(line)
  }

  const byName = <T extends { branchName?: string; staffName?: string }>(a: T, b: T) =>
    (a.branchName ?? a.staffName ?? '').localeCompare(b.branchName ?? b.staffName ?? '')

  return [...branches.values()]
    .sort(byName)
    .map((branch) => ({ ...branch, collectors: [...branch.collectors].sort(byName) }))
}

function Amount({ paisa, className }: { paisa: number; className?: string }) {
  return (
    <span className={cn('tabular-nums', paisa < 0 && 'text-destructive', className)}>
      {formatMoney(paisa)}
    </span>
  )
}

/** "refund" / "never received" -- why a line is negative. */
function KindNote({ kind }: { kind: Row['kind'] }) {
  if (kind === 'payment') return null
  return (
    <span className="ml-1 text-xs text-destructive">
      {kind === 'refund' ? 'refund' : 'never received'}
    </span>
  )
}

export function CollectionSheet({
  rows,
  detail,
  summary,
  previous,
  discounts,
  on,
}: {
  rows: Row[]
  detail: Detail[]
  /** The totals rows -- the ones with a null branch_id. */
  summary: SummaryRow | null
  previous: SummaryRow | null
  discounts: DiscountRow[]
  on: string
}) {
  const groups = groupRows(rows, detail)

  if (groups.length === 0 && (!summary || summary.invoice_count === 0)) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Nothing collected on {formatDate(on)}.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {summary ? (
        <CollectionSummary summary={summary} previous={previous} on={on} />
      ) : null}

      <CollectionDiscounts rows={discounts} />

      {groups.map((branch) => (
        <section key={branch.branchId} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-semibold">{branch.branchName}</h2>
            <Amount paisa={branch.totalPaisa} className="font-semibold" />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Collected by</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Txns</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>

            {branch.collectors.map((collector) => (
              <ExpandableCollector
                key={collector.staffId}
                label={collector.staffName}
                detailCount={collector.detail.length}
                methodRows={collector.rows.map((row, index) => (
                  <tr
                    key={`${collector.staffId}-${row.method}-${row.kind}`}
                    className="border-b"
                  >
                    <td className="p-2 align-middle font-medium">
                      {index === 0 ? collector.staffName : ''}
                    </td>
                    <td className="p-2 align-middle">
                      {PAYMENT_METHOD_LABELS[row.method]}
                      <KindNote kind={row.kind} />
                    </td>
                    <td className="p-2 text-right align-middle tabular-nums">
                      {row.txn_count}
                    </td>
                    <td className="p-2 text-right align-middle">
                      <Amount paisa={row.amount_paisa} />
                    </td>
                  </tr>
                ))}
                detailRows={collector.detail.map((line) => (
                  <tr
                    key={line.payment_id}
                    data-detail
                    className="border-b bg-muted/10 text-sm"
                  >
                    <td className="py-1.5 pr-2 pl-8 align-middle">
                      <span className="text-muted-foreground tabular-nums">
                        {formatTime(line.paid_at)}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 align-middle">
                      <Link
                        href={`/members/${line.member_id}`}
                        className="font-medium hover:underline"
                      >
                        {line.member_name}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {line.member_code}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {PAYMENT_METHOD_LABELS[line.method]}
                        <KindNote kind={line.kind} />
                        {line.reference_no ? ` · ${line.reference_no}` : ''}
                        {line.invoice_no ? ` · ${line.invoice_no}` : ''}
                      </span>
                      {line.reason ? (
                        <span className="block text-xs text-muted-foreground italic">
                          {line.reason}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-2 text-right align-middle">
                      <a
                        href={`/receipts/${line.payment_id}/print`}
                        target="_blank"
                        rel="noopener"
                        className="text-xs text-muted-foreground hover:underline print:hidden"
                      >
                        Receipt
                      </a>
                    </td>
                    <td className="py-1.5 pr-2 text-right align-middle">
                      <Amount paisa={line.amount_paisa} />
                    </td>
                  </tr>
                ))}
                subtotalCells={
                  <>
                    <td className="p-2 align-middle" />
                    <td className="p-2 text-right align-middle tabular-nums">
                      {collector.txnCount}
                    </td>
                    <td className="p-2 text-right align-middle">
                      <Amount paisa={collector.totalPaisa} className="font-semibold" />
                    </td>
                  </>
                }
              />
            ))}

            <TableFooter className="print:table-footer-group">
              <TableRow>
                <td className="p-2 align-middle" colSpan={2}>
                  {branch.branchName} total
                </td>
                <td className="p-2 text-right align-middle tabular-nums">
                  {branch.txnCount}
                </td>
                <td className="p-2 text-right align-middle">
                  <Amount paisa={branch.totalPaisa} className="font-semibold" />
                </td>
              </TableRow>
            </TableFooter>
          </Table>
        </section>
      ))}

      {groups.length > 1 && summary ? (
        <div className="flex items-baseline justify-between border-t-2 pt-3">
          <span className="text-base font-semibold">Grand total (net)</span>
          <Amount paisa={summary.net_paisa} className="text-xl font-semibold" />
        </div>
      ) : null}

      <CollectionMembers detail={detail} />
    </div>
  )
}
