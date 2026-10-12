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
import { trainerUtilization } from '@/lib/db/trainer-utilization'
import { formatDate } from '@/lib/format'
import { resolvePeriod } from '@/lib/reports/period'
import { resolveBranchScope } from '@/lib/scope'

export default async function TrainerUtilizationPage({
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
          <h1 className="text-2xl font-semibold">Trainer utilization</h1>
          <p className="text-sm text-muted-foreground print:hidden">
            Class fill, attendance and personal-training hours for {scope.label} between{' '}
            {formatDate(period.from)} and {formatDate(period.to)}.
          </p>
        </div>
        <Suspense fallback={null}>
          <CsvLink report="trainers" />
        </Suspense>
      </div>

      <Suspense>
        <PeriodPicker period={period} />
      </Suspense>

      <Suspense
        key={`${period.from}:${period.to}:${scope.label}`}
        fallback={<TableSkeleton rows={6} columns={9} />}
      >
        <Body branchIds={scope.branchIds} from={period.from} to={period.to} label={scope.label} />
      </Suspense>
    </div>
  )
}

async function Body({
  branchIds,
  from,
  to,
  label,
}: {
  branchIds: string[] | null
  from: string
  to: string
  label: string
}) {
  const rows = await trainerUtilization({ branchIds, from, to })

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No classes or personal-training sessions for {label} in this period.
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Trainer</TableHead>
          <TableHead>Branch</TableHead>
          <TableHead className="text-right">Classes</TableHead>
          <TableHead className="text-right">Class hours</TableHead>
          <TableHead className="text-right">Fill</TableHead>
          <TableHead className="text-right">Attended</TableHead>
          <TableHead className="text-right">No-shows</TableHead>
          <TableHead className="text-right">PT done</TableHead>
          <TableHead className="text-right">PT hours</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.trainer_id}-${row.branch_id}`}>
            <TableCell>{row.trainer_name}</TableCell>
            <TableCell>{row.branch_name}</TableCell>
            <TableCell className="text-right tabular-nums">{row.classes_held}</TableCell>
            <TableCell className="text-right tabular-nums">{row.class_hours}</TableCell>
            <TableCell className="text-right tabular-nums">
              {row.seats_filled}/{row.seats_available} ({row.fill_pct}%)
            </TableCell>
            <TableCell className="text-right tabular-nums">{row.attended}</TableCell>
            <TableCell className="text-right tabular-nums">{row.no_shows}</TableCell>
            <TableCell className="text-right tabular-nums">{row.pt_completed}</TableCell>
            <TableCell className="text-right tabular-nums">{row.pt_hours}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
