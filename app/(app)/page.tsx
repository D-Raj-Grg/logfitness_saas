import { Suspense } from 'react'

import { ChartSkeleton, StatusTilesSkeleton, TableSkeleton } from '@/components/app/skeletons'
import { BranchTable } from '@/components/dashboard/branch-table'
import {
  AttendancePanel,
  MovementPanel,
  RevenuePanel,
} from '@/components/dashboard/panels'
import { StatusTiles } from '@/components/dashboard/status-tiles'
import { requireStaff } from '@/lib/auth'
import { orgSnapshot } from '@/lib/db/reports'
import { canViewReports } from '@/lib/roles'
import { resolveBranchScope } from '@/lib/scope'

/**
 * org_snapshot is the slowest thing on the dashboard and the greeting does not
 * depend on it, so it reads the snapshot here instead of in the page body. The
 * name and the branch label flush first; the numbers land underneath.
 */
async function Snapshot({
  branchIds,
  compact,
}: {
  branchIds: string[] | null
  compact: boolean
}) {
  const rows = await orgSnapshot(branchIds)
  const totals = rows.find((row) => row.branch_id === null)
  const branches = rows.filter(
    (row): row is typeof row & { branch_id: string; branch_name: string } =>
      row.branch_id !== null
  )

  return (
    <>
      <StatusTiles snapshot={totals} compact={compact} />

      {/* One branch is not a chain -- the table would repeat the tiles. */}
      {branches.length > 1 ? <BranchTable rows={branches} /> : null}
    </>
  )
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const staff = await requireStaff()
  const scope = await resolveBranchScope(await searchParams, staff)
  const compact = staff.role === 'trainer'
  // Trainers see who is in and who is lapsing, not the takings. Same line the
  // tiles are drawn from, so the two never disagree.
  const charts = canViewReports(staff)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Good to see you, {staff.fullName}</h1>
        <p className="text-sm text-muted-foreground">
          {staff.orgName} · {scope.label}
        </p>
      </div>

      <Suspense
        key={scope.label}
        fallback={
          <>
            <StatusTilesSkeleton count={compact ? 2 : 5} />
            <TableSkeleton rows={4} columns={6} />
          </>
        }
      >
        <Snapshot branchIds={scope.branchIds} compact={compact} />
      </Suspense>

      {/* Each panel is its own boundary: three reports at three different
          speeds, and the fast ones should not wait on the slow one. The
          tiles above them never wait on any of it. */}
      {charts ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {/* Revenue is the one people read first, so it gets the full width
              and the other two share the row underneath. */}
          <div className="lg:col-span-2">
            <Suspense key={`revenue-${scope.label}`} fallback={<ChartSkeleton />}>
              <RevenuePanel branchIds={scope.branchIds} />
            </Suspense>
          </div>
          <Suspense key={`attendance-${scope.label}`} fallback={<ChartSkeleton />}>
            <AttendancePanel branchIds={scope.branchIds} />
          </Suspense>
          <Suspense key={`movement-${scope.label}`} fallback={<ChartSkeleton />}>
            <MovementPanel branchIds={scope.branchIds} />
          </Suspense>
        </div>
      ) : null}
    </div>
  )
}
