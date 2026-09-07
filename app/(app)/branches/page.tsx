import { BranchForm } from '@/components/branches/branch-form'
import { BranchesTable, type BranchListRow } from '@/components/branches/branches-table'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { requireRole } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'

export default async function BranchesPage() {
  await requireRole('owner')

  const branches = await listBranches()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Branches</h1>
        <p className="text-sm text-muted-foreground">
          Every location your gym runs. Deactivating one keeps its members
          and history -- nothing about a branch is ever deleted.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a branch</CardTitle>
          <CardDescription>New locations start active.</CardDescription>
        </CardHeader>
        <CardContent>
          <BranchForm />
        </CardContent>
      </Card>

      <BranchesTable rows={branches as BranchListRow[]} />
    </div>
  )
}
