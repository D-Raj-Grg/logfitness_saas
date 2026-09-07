import { Suspense } from 'react'

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
import { resolvePeriod } from '@/lib/reports/period'
import { resolveBranchScope } from '@/lib/scope'

export default async function RevenueReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const staff = await requireRole('owner', 'manager')
  const params = await searchParams
  const scope = await resolveBranchScope(params, staff)
  const period = resolvePeriod(params)

  const rows = await revenueReport({
    branchIds: scope.branchIds,
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

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No revenue for {scope.label} between {formatDate(period.from)} and{' '}
          {formatDate(period.to)}.
        </p>
      ) : (
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
      )}
    </div>
  )
}
