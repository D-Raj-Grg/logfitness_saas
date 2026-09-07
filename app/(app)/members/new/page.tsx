import { MemberForm, type MemberPrefill } from '@/components/members/member-form'
import type { PlanFormContext } from '@/components/plans/plan-dialog'
import { requireRole } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'
import { getVisitor } from '@/lib/db/visitors'
import { visitorIdSchema } from '@/lib/validation/visitors'

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function NewMemberPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireRole('owner', 'manager', 'front_desk')
  const params = await searchParams

  const allBranches = await listBranches()
  const branches =
    staff.role === 'owner'
      ? allBranches
      : allBranches.filter((branch) => staff.branchIds.includes(branch.id))

  // Registering someone from the visitor log. A stale, forged or malformed id
  // simply registers a member from scratch: the shape is checked here so a bad
  // one is not sent to Postgres as a uuid, RLS bounds the read, and a dead link
  // does not produce a dead screen.
  const requested = visitorIdSchema.safeParse({ visitorId: first(params.visitor) })
  const visitor = requested.success ? await getVisitor(requested.data.visitorId) : null
  const prefill: MemberPrefill | undefined =
    visitor && visitor.status !== 'converted'
      ? {
          visitorId: visitor.id,
          fullName: visitor.full_name,
          phone: visitor.phone,
          branchId:
            branches.some((branch) => branch.id === visitor.branch_id)
              ? visitor.branch_id
              : null,
        }
      : undefined

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
          {prefill
            ? `${prefill.fullName} walked in before. Their details are filled in, and the visitor log is marked once they are registered.`
            : 'Name, phone and branch are enough. Sell them a plan in the same step, or leave it for their profile.'}
        </p>
      </div>

      <MemberForm branches={branches} planContext={planContext} prefill={prefill} />
    </div>
  )
}
