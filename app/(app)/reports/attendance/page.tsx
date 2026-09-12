import { Suspense } from 'react'

import { ChartSkeleton, TableSkeleton } from '@/components/app/skeletons'
import { AttendanceTrendChart } from '@/components/reports/attendance-trend-chart-lazy'
import { CsvLink } from '@/components/reports/csv-link'
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
import { resolvePeriod, type ResolvedPeriod } from '@/lib/reports/period'
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Attendance trend</h1>
          <p className="text-sm text-muted-foreground print:hidden">
            Check-ins and distinct members by {period.groupBy} and branch, for {scope.label}{' '}
            between {formatDate(period.from)} and {formatDate(period.to)}.
          </p>
        </div>
        <Suspense fallback={null}>
          <CsvLink report="attendance" />
        </Suspense>
      </div>

      <Suspense>
        <PeriodPicker period={period} />
      </Suspense>

      {/* Re-keyed per period and scope so a new range swaps in the skeleton
          rather than leaving the previous one's chart on screen. */}
      <Suspense
        key={`${period.from}:${period.to}:${period.groupBy}:${scope.label}`}
        fallback={
          <>
            <ChartSkeleton />
            <TableSkeleton rows={8} columns={4} />
          </>
        }
      >
        <AttendanceBody
          branchIds={scope.branchIds}
          period={period}
          label={scope.label}
        />
      </Suspense>
    </div>
  )
}

/**
 * The trend query and everything drawn from it. Kept out of the page body so
 * the heading, CSV link and period picker flush immediately -- a wide range is
 * slow, and the control to narrow it should not wait on the result.
 */
async function AttendanceBody({
  branchIds,
  period,
  label,
}: {
  branchIds: string[] | null
  period: ResolvedPeriod
  label: string
}) {
  const rows = await attendanceTrend({
    branchIds,
    from: period.from,
    to: period.to,
    groupBy: period.groupBy,
  })

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No check-ins for {label} between {formatDate(period.from)} and{' '}
        {formatDate(period.to)}.
      </p>
    )
  }

  return (
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
  )
}
