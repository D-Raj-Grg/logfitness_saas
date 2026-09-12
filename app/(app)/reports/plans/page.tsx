import { Suspense } from 'react'

import { TableSkeleton } from '@/components/app/skeletons'
import { CsvLink } from '@/components/reports/csv-link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { requireRole } from '@/lib/auth'
import { planMix } from '@/lib/db/reports'
import { formatMoney } from '@/lib/format'
import { resolveBranchScope } from '@/lib/scope'

export default async function PlanMixPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const staff = await requireRole('owner', 'manager')
  const params = await searchParams
  const scope = await resolveBranchScope(params, staff)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Plan mix</h1>
          <p className="text-sm text-muted-foreground print:hidden">
            Active memberships and billed revenue by plan, for {scope.label}. Share is each
            plan&apos;s slice of its own branch&apos;s active memberships.
          </p>
        </div>
        <Suspense fallback={null}>
          <CsvLink report="plans" />
        </Suspense>
      </div>

      {/* Re-keyed on scope so switching branch swaps in the skeleton rather
          than leaving the previous branch's mix on screen. */}
      <Suspense key={scope.label} fallback={<TableSkeleton rows={6} columns={5} />}>
        <PlanMixBody branchIds={scope.branchIds} label={scope.label} />
      </Suspense>
    </div>
  )
}

/**
 * The mix query and the per-branch grouping it feeds. Held out of the page body
 * so the heading and the CSV link flush first.
 */
async function PlanMixBody({
  branchIds,
  label,
}: {
  branchIds: string[] | null
  label: string
}) {
  const rows = await planMix(branchIds)

  // plan_mix's own share_pct is each row's share of every active membership
  // IN SCOPE, not of its own branch -- correct for a single-branch view, but
  // misleading next to a branch name once more than one branch is on screen.
  // Rather than show that number beside a branch column, this groups by
  // branch and computes each plan's share of ITS branch locally.
  const byBranch = new Map<
    string,
    { branchName: string; rows: typeof rows; totalActive: number }
  >()
  for (const row of rows) {
    const group = byBranch.get(row.branch_id) ?? {
      branchName: row.branch_name,
      rows: [],
      totalActive: 0,
    }
    group.rows.push(row)
    group.totalActive += row.active_memberships
    byBranch.set(row.branch_id, group)
  }
  const groups = Array.from(byBranch.values()).sort((a, b) =>
    a.branchName.localeCompare(b.branchName)
  )

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No active memberships for {label}.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.branchName} className="flex flex-col gap-2">
          {groups.length > 1 ? (
            <h2 className="text-sm font-medium text-muted-foreground">{group.branchName}</h2>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="text-right">Active memberships</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.rows.map((row) => (
                <TableRow key={row.plan_id}>
                  <TableCell>{row.plan_name}</TableCell>
                  <TableCell className="capitalize">{row.plan_kind}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.active_memberships}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(row.revenue_paisa)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {group.totalActive === 0
                      ? '—'
                      : `${((row.active_memberships / group.totalActive) * 100).toFixed(1)}%`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  )
}
