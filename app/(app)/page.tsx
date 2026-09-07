import { BranchTable } from '@/components/dashboard/branch-table'
import { StatusTiles } from '@/components/dashboard/status-tiles'
import { requireStaff } from '@/lib/auth'
import { orgSnapshot } from '@/lib/db/reports'
import { resolveBranchScope } from '@/lib/scope'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const staff = await requireStaff()
  const scope = await resolveBranchScope(await searchParams, staff)

  const rows = await orgSnapshot(scope.branchIds)
  const totals = rows.find((row) => row.branch_id === null)
  const branches = rows.filter(
    (row): row is typeof row & { branch_id: string; branch_name: string } =>
      row.branch_id !== null
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Good to see you, {staff.fullName}</h1>
        <p className="text-sm text-muted-foreground">
          {staff.orgName} · {scope.label}
        </p>
      </div>

      <StatusTiles snapshot={totals} compact={staff.role === 'trainer'} />

      {/* One branch is not a chain -- the table would repeat the tiles. */}
      {branches.length > 1 ? <BranchTable rows={branches} /> : null}
    </div>
  )
}
