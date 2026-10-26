import { NewPlanButton, type PlanFormContext } from '@/components/plans/plan-dialog'
import { PlansTable } from '@/components/plans/plans-table'
import { requireRole } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'
import { getFeeContext, listActiveFees } from '@/lib/db/fees'
import { listPlans } from '@/lib/db/plans'

export default async function PlansPage() {
  const staff = await requireRole('owner', 'manager')

  const [plans, branches, fees, feeContext] = await Promise.all([
    listPlans(),
    listBranches(),
    listActiveFees(),
    getFeeContext(staff.orgId),
  ])

  // Which fees each plan carries, by name, for the Fees column.
  const planFees = Object.fromEntries(
    plans.map((plan) => [
      plan.id,
      fees
        .filter((fee) => fee.all_plans || fee.plan_ids.includes(plan.id))
        .map((fee) => fee.name),
    ])
  )

  const branchNames = Object.fromEntries(
    branches.map((branch) => [branch.id, branch.name])
  )

  const context: PlanFormContext = {
    branches: branches.map(({ id, name }) => ({ id, name })),
    actorRole: staff.role,
    actorBranchIds: staff.branchIds,
    catalogueEnabled: feeContext.catalogueEnabled,
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

      <PlansTable
        rows={plans}
        branchNames={branchNames}
        context={context}
        planFees={planFees}
      />
    </div>
  )
}
