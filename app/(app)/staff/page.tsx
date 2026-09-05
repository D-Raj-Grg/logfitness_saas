import { InviteStaffForm } from '@/components/staff/invite-staff-form'
import { StaffTable, type StaffListRow } from '@/components/staff/staff-table'
import { requireRole } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'
import { listStaff } from '@/lib/db/staff'

export default async function StaffPage() {
  const staff = await requireRole('owner', 'manager')

  const [rows, branches] = await Promise.all([listStaff(), listBranches()])

  const branchNames = Object.fromEntries(
    branches.map((branch) => [branch.id, branch.name])
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Staff</h1>
        <p className="text-sm text-muted-foreground">
          Who can sign in, and which branches they work at.
        </p>
      </div>

      <InviteStaffForm actorRole={staff.role} branches={branches} />

      <StaffTable
        rows={rows as StaffListRow[]}
        branchNames={branchNames}
        currentStaffId={staff.staffId}
      />
    </div>
  )
}
