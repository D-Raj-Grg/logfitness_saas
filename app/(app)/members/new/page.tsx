import { MemberForm } from '@/components/members/member-form'
import type { PlanFormContext } from '@/components/plans/plan-dialog'
import { requireRole } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'

export default async function NewMemberPage() {
  const staff = await requireRole('owner', 'manager', 'front_desk')

  const allBranches = await listBranches()
  const branches =
    staff.role === 'owner'
      ? allBranches
      : allBranches.filter((branch) => staff.branchIds.includes(branch.id))

  const planContext: PlanFormContext = {
    branches: branches.map(({ id, name }) => ({ id, name })),
    actorRole: staff.role,
    actorBranchIds: staff.branchIds,
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Register a member</h1>
        <p className="text-sm text-muted-foreground">
          Name, phone and branch are enough. Sell them a plan in the same step, or
          leave it for their profile.
        </p>
      </div>

      <MemberForm branches={branches} planContext={planContext} />
    </div>
  )
}
