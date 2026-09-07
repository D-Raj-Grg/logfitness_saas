import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { dailyCollection } from '@/lib/db/payments'
import { formatDate, formatMoney } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '@/lib/members'
import { cn } from '@/lib/utils'

type Row = Awaited<ReturnType<typeof dailyCollection>>[number]

type CollectorGroup = {
  staffId: string
  staffName: string
  rows: Row[]
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

/** Branch -> collector -> method/kind lines, with paisa totals at each level. */
function groupRows(rows: Row[]): BranchGroup[] {
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

export function CollectionSheet({ rows, on }: { rows: Row[]; on: string }) {
  const groups = groupRows(rows)
  const grandTotal = rows.reduce((sum, row) => sum + row.amount_paisa, 0)
  const grandCount = rows.reduce((sum, row) => sum + row.txn_count, 0)

  if (groups.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Nothing collected on {formatDate(on)}.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-4 rounded-lg border bg-muted/40 px-4 py-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Net collected · {formatDate(on)}
          </p>
          <p className="text-xs text-muted-foreground">
            {grandCount} transaction{grandCount === 1 ? '' : 's'} across{' '}
            {groups.length} branch{groups.length === 1 ? '' : 'es'}
          </p>
        </div>
        <Amount paisa={grandTotal} className="text-2xl font-semibold" />
      </div>

      {groups.map((branch) => (
        <section key={branch.branchId} className="flex flex-col gap-2 break-inside-avoid">
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
            <TableBody>
              {branch.collectors.map((collector) =>
                collector.rows.map((row, index) => (
                  <TableRow key={`${collector.staffId}-${row.method}-${row.kind}`}>
                    <TableCell className="font-medium">
                      {index === 0 ? collector.staffName : ''}
                    </TableCell>
                    <TableCell>
                      {PAYMENT_METHOD_LABELS[row.method]}
                      {row.kind !== 'payment' ? (
                        <span className="ml-1 text-xs text-destructive">
                          {row.kind === 'refund' ? 'refund' : 'never received'}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.txn_count}</TableCell>
                    <TableCell className="text-right">
                      <Amount paisa={row.amount_paisa} />
                    </TableCell>
                  </TableRow>
                )).concat(
                  <TableRow key={`${collector.staffId}-subtotal`} className="bg-muted/30">
                    <TableCell colSpan={2} className="text-sm font-medium">
                      {collector.staffName} subtotal
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{collector.txnCount}</TableCell>
                    <TableCell className="text-right">
                      <Amount paisa={collector.totalPaisa} className="font-semibold" />
                    </TableCell>
                  </TableRow>
                )
              )}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>{branch.branchName} total</TableCell>
                <TableCell className="text-right tabular-nums">{branch.txnCount}</TableCell>
                <TableCell className="text-right">
                  <Amount paisa={branch.totalPaisa} className="font-semibold" />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </section>
      ))}

      {groups.length > 1 ? (
        <div className="flex items-baseline justify-between border-t-2 pt-3">
          <span className="text-base font-semibold">Grand total (net)</span>
          <Amount paisa={grandTotal} className="text-xl font-semibold" />
        </div>
      ) : null}
    </div>
  )
}
