import { StatusTiles } from '@/components/dashboard/status-tiles'
import { requireStaff } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'
import { memberStatusCounts } from '@/lib/db/members'
import { dailyCollection } from '@/lib/db/payments'

/** Net paisa collected today across the branches the caller can see. */
async function todaysCollection(branchIds: string[] | null) {
  const sheets =
    branchIds === null
      ? [await dailyCollection()]
      : await Promise.all(branchIds.map((branchId) => dailyCollection({ branchId })))

  return sheets.flat().reduce((sum, row) => sum + row.amount_paisa, 0)
}

export default async function DashboardPage() {
  const staff = await requireStaff()

  const isOwner = staff.role === 'owner'
  const isTrainer = staff.role === 'trainer'
  // Managers may run several branches; the tiles show the first until the
  // chain-layer phase adds a branch picker.
  const scopeBranchId = isOwner ? undefined : staff.branchIds[0]

  const [branches, counts, collectionPaisa] = await Promise.all([
    listBranches(),
    memberStatusCounts(scopeBranchId),
    isTrainer ? Promise.resolve(undefined) : todaysCollection(isOwner ? null : staff.branchIds),
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
