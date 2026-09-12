import { Suspense } from 'react'

import { TableSkeleton } from '@/components/app/skeletons'
import { CsvLink } from '@/components/reports/csv-link'
import { PeriodPicker } from '@/components/reports/period-picker'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { requireRole } from '@/lib/auth'
import { revenueReport } from '@/lib/db/reports'
import { formatDate, formatMoney } from '@/lib/format'
import { resolvePeriod, type ResolvedPeriod } from '@/lib/reports/period'
import { resolveBranchScope } from '@/lib/scope'

/**
 * The report itself. Reading it here rather than in the page body keeps the
 * heading, the CSV link and the period picker in the static shell: a wide date
 * range can take seconds, and the controls that would let someone narrow it
 * should not be hostage to the query they are trying to change.
 */
async function RevenueBody({
  branchIds,
  period,
  label,
}: {
  branchIds: string[] | null
  period: ResolvedPeriod
  label: string
}) {
  const rows = await revenueReport({
    branchIds,
    from: period.from,
    to: period.to,
    groupBy: period.groupBy,
  })

  const totals = rows.reduce(
    (acc, row) => ({
      gross: acc.gross + row.gross_paisa,
      refunds: acc.refunds + row.refunds_paisa,
      reversals: acc.reversals + row.reversals_paisa,
      net: acc.net + row.net_paisa,
      txns: acc.txns + row.txn_count,
    }),
    { gross: 0, refunds: 0, reversals: 0, net: 0, txns: 0 }
  )

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No revenue for {label} between {formatDate(period.from)} and{' '}
        {formatDate(period.to)}.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Period</TableHead>
          <TableHead>Branch</TableHead>
          <TableHead>Method</TableHead>
          <TableHead className="text-right">Gross</TableHead>
          <TableHead className="text-right">Refunds</TableHead>
          <TableHead className="text-right">Reversals</TableHead>
          <TableHead className="text-right">Net</TableHead>
          <TableHead className="text-right">Transactions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={`${row.period}-${row.branch_id}-${row.method}-${index}`}>
            <TableCell>{formatDate(row.period)}</TableCell>
            <TableCell>{row.branch_name}</TableCell>
            <TableCell className="capitalize">{row.method}</TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(row.gross_paisa)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(row.refunds_paisa)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(row.reversals_paisa)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatMoney(row.net_paisa)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{row.txn_count}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={3}>Total</TableCell>
          <TableCell className="text-right tabular-nums">{formatMoney(totals.gross)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatMoney(totals.refunds)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatMoney(totals.reversals)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatMoney(totals.net)}</TableCell>
          <TableCell className="text-right tabular-nums">{totals.txns}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}

export default async function RevenueReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const staff = await requireRole('owner', 'manager')
  const params = await searchParams
  const scope = await resolveBranchScope(params, staff)
  const period = resolvePeriod(params)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Revenue</h1>
          <p className="text-sm text-muted-foreground print:hidden">
            Gross, refunds, reversals and net, by {period.groupBy}, branch and method, for{' '}
            {scope.label} between {formatDate(period.from)} and {formatDate(period.to)}.
          </p>
        </div>
        <Suspense fallback={null}>
          <CsvLink report="revenue" />
        </Suspense>
      </div>

      <Suspense>
        <PeriodPicker period={period} />
      </Suspense>

      {/* Re-keyed per period and scope so changing either swaps in the skeleton
          instead of leaving the previous range's numbers on screen. */}
      <Suspense
        key={`${period.from}:${period.to}:${period.groupBy}:${scope.label}`}
        fallback={<TableSkeleton rows={8} columns={8} />}
      >
        <RevenueBody branchIds={scope.branchIds} period={period} label={scope.label} />
      </Suspense>
    </div>
  )
}
