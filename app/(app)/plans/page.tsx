import { NewPlanButton, type PlanFormContext } from '@/components/plans/plan-dialog'
import { PlansTable } from '@/components/plans/plans-table'
import { requireRole } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'
import { listPlans } from '@/lib/db/plans'

export default async function PlansPage() {
  const staff = await requireRole('owner', 'manager')

  const [plans, branches] = await Promise.all([listPlans(), listBranches()])

  const branchNames = Object.fromEntries(
    branches.map((branch) => [branch.id, branch.name])
  )

  const context: PlanFormContext = {
    branches: branches.map(({ id, name }) => ({ id, name })),
    actorRole: staff.role,
    actorBranchIds: staff.branchIds,
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Plans</h1>
          <p className="text-sm text-muted-foreground">
            What the front desk can sell, and at which branches.
          </p>
        </div>
        <NewPlanButton context={context} />
      </div>

      <PlansTable rows={plans} branchNames={branchNames} context={context} />
    </div>
  )
}
