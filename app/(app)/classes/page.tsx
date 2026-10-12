import Link from 'next/link'

import { ClassesTable, NewClassButton } from '@/components/classes/classes-table'
import type { ClassFormContext } from '@/components/classes/class-form'
import { buttonVariants } from '@/components/ui/button'
import { requireStaff } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'
import { listClasses, listTrainers } from '@/lib/db/classes'
import { resolveBranchScope } from '@/lib/scope'

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireStaff()
  const scope = await resolveBranchScope(await searchParams, staff)
  const canEdit = staff.role === 'owner' || staff.role === 'manager'

  const [classes, branches, trainers] = await Promise.all([
    listClasses(scope.branchIds),
    listBranches(),
    listTrainers(),
  ])

  const writable =
    staff.role === 'owner' ? branches : branches.filter((b) => staff.branchIds.includes(b.id))
  const context: ClassFormContext = {
    branches: writable.map(({ id, name }) => ({ id, name })),
    trainers,
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Classes</h1>
          <p className="text-sm text-muted-foreground">
            What the gym runs on a schedule, and who teaches it.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/classes/timetable" className={buttonVariants({ variant: 'outline' })}>
            Timetable
          </Link>
          {canEdit ? <NewClassButton context={context} /> : null}
        </div>
      </div>

      <ClassesTable
        rows={classes}
        branchNames={Object.fromEntries(branches.map((b) => [b.id, b.name]))}
        trainerNames={Object.fromEntries(trainers.map((t) => [t.id, t.full_name]))}
        context={context}
        canEdit={canEdit}
      />
    </div>
  )
}
