import { Suspense } from 'react'

import { AttendanceTrendChart } from '@/components/reports/attendance-trend-chart'
import { PeriodPicker } from '@/components/reports/period-picker'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { requireRole } from '@/lib/auth'
import { attendanceTrend } from '@/lib/db/reports'
import { formatDate } from '@/lib/format'
import { resolvePeriod } from '@/lib/reports/period'
import { resolveBranchScope } from '@/lib/scope'

export default async function AttendanceTrendPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const staff = await requireRole('owner', 'manager')
  const params = await searchParams
  const scope = await resolveBranchScope(params, staff)
  const period = resolvePeriod(params)

  const rows = await attendanceTrend({
    branchIds: scope.branchIds,
    from: period.from,
    to: period.to,
    groupBy: period.groupBy,
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Attendance trend</h1>
        <p className="text-sm text-muted-foreground print:hidden">
          Check-ins and distinct members by {period.groupBy} and branch, for {scope.label}{' '}
          between {formatDate(period.from)} and {formatDate(period.to)}.
        </p>
      </div>

      <Suspense>
        <PeriodPicker period={period} />
      </Suspense>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No check-ins for {scope.label} between {formatDate(period.from)} and{' '}
          {formatDate(period.to)}.
        </p>
      ) : (
        <>
          <AttendanceTrendChart points={rows} />

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead className="text-right">Check-ins</TableHead>
                <TableHead className="text-right">Distinct members</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={`${row.period}-${row.branch_id}-${index}`}>
                  <TableCell>{formatDate(row.period)}</TableCell>
                  <TableCell>{row.branch_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.check_ins}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.distinct_members}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  )
}
