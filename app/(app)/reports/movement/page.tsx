import { Suspense } from 'react'

import { TableSkeleton } from '@/components/app/skeletons'
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
import { membershipMovement } from '@/lib/db/reports'
import { formatDate } from '@/lib/format'
import { resolvePeriod, type ResolvedPeriod } from '@/lib/reports/period'
import { resolveBranchScope } from '@/lib/scope'

/**
 * Kept out of the page body so the heading, CSV link and period picker are part
 * of the static shell -- a wide range is slow, and the control to narrow it
 * should not wait on the result it is meant to change.
 */
async function MovementBody({
  branchIds,
  period,
  label,
}: {
  branchIds: string[] | null
  period: ResolvedPeriod
  label: string
}) {
  const rows = await membershipMovement({
    branchIds,
    from: period.from,
    to: period.to,
    groupBy: period.groupBy,
  })

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No membership movement for {label} between {formatDate(period.from)} and{' '}
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
          <TableHead className="text-right">New</TableHead>
          <TableHead className="text-right">Renewals</TableHead>
          <TableHead className="text-right">Expiries</TableHead>
          <TableHead className="text-right">Churned</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={`${row.period}-${row.branch_id}-${index}`}>
            <TableCell>{formatDate(row.period)}</TableCell>
            <TableCell>{row.branch_name}</TableCell>
            <TableCell className="text-right tabular-nums">{row.new_members}</TableCell>
            <TableCell className="text-right tabular-nums">{row.renewals}</TableCell>
            <TableCell className="text-right tabular-nums">{row.expiries}</TableCell>
            <TableCell className="text-right tabular-nums">{row.churned}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default async function MembershipMovementPage({
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
          <h1 className="text-2xl font-semibold">Membership movement</h1>
          <p className="text-sm text-muted-foreground print:hidden">
            New, renewed, expired and churned members, by {period.groupBy} and branch, for{' '}
            {scope.label} between {formatDate(period.from)} and {formatDate(period.to)}.
          </p>
        </div>
        <Suspense fallback={null}>
          <CsvLink report="movement" />
        </Suspense>
      </div>

      <Suspense>
        <PeriodPicker period={period} />
      </Suspense>

      <Suspense
        key={`${period.from}:${period.to}:${period.groupBy}:${scope.label}`}
        fallback={<TableSkeleton rows={8} columns={6} />}
      >
        <MovementBody branchIds={scope.branchIds} period={period} label={scope.label} />
      </Suspense>
    </div>
  )
}
