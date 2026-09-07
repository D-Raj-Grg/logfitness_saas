import { StatusTiles } from '@/components/dashboard/status-tiles'
import { requireStaff } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'
import { memberStatusCounts } from '@/lib/db/members'
import { dailyCollection } from '@/lib/db/payments'

/** Net paisa collected today across the branches the caller can see. */
async function todaysCollection(branchIds: string[] | null) {
  const rows = await dailyCollection({ branchIds })
  return rows.reduce((sum, row) => sum + row.amount_paisa, 0)
}

export default async function DashboardPage() {
  const staff = await requireStaff()

  const isOwner = staff.role === 'owner'
  const isTrainer = staff.role === 'trainer'
  // Managers may run several branches; the tiles show the first until the
  // chain-layer phase adds a branch picker.
  const scopeBranchIds = isOwner ? null : staff.branchIds
  const scopeBranchId = isOwner ? undefined : staff.branchIds[0]

  const [branches, counts, collectionPaisa] = await Promise.all([
    listBranches(),
    memberStatusCounts(scopeBranchIds),
    isTrainer ? Promise.resolve(undefined) : todaysCollection(scopeBranchIds),
  ])

  const scopeName = scopeBranchId
    ? branches.find((branch) => branch.id === scopeBranchId)?.name
    : null

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Good to see you, {staff.fullName}</h1>
        <p className="text-sm text-muted-foreground">
          {branches.length} branch{branches.length === 1 ? '' : 'es'} in {staff.orgName}
          {scopeName ? ` · showing ${scopeName}` : ''}
        </p>
      </div>

      <StatusTiles counts={counts} collectionPaisa={collectionPaisa} compact={isTrainer} />
    </div>
  )
}
