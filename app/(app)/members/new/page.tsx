import { MemberForm } from '@/components/members/member-form'
import { requireRole } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'

export default async function NewMemberPage() {
  const staff = await requireRole('owner', 'manager', 'front_desk')

  const allBranches = await listBranches()
  const branches =
    staff.role === 'owner'
      ? allBranches
      : allBranches.filter((branch) => staff.branchIds.includes(branch.id))

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Register a member</h1>
        <p className="text-sm text-muted-foreground">
          A membership plan can be assigned from their profile right after.
        </p>
      </div>

      <MemberForm branches={branches} />
    </div>
  )
}
