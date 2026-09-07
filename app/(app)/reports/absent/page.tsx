import { Suspense } from 'react'

import { AbsentFilters } from '@/components/attendance/absent-filters'
import { AbsentMembersTable } from '@/components/attendance/absent-members-table'
import { CsvLink } from '@/components/reports/csv-link'
import { requireRole } from '@/lib/auth'
import { absentMembers } from '@/lib/db/attendance'
import { resolveBranchScope } from '@/lib/scope'
import { absentQuerySchema } from '@/lib/validation/attendance'

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function AbsentMembersPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const staff = await requireRole('owner', 'manager')
  const params = await searchParams
  const scope = await resolveBranchScope(params, staff)

  const branches = scope.options
  const branchId = scope.selectedId

  const parsed = absentQuerySchema.safeParse({
    branchId: branchId ?? undefined,
    minDays: first(params.minDays),
    band: first(params.band) || undefined,
  })
  // A hand-edited URL should not 500 the branch office; fall back to defaults.
  const query = parsed.success ? parsed.data : absentQuerySchema.parse({})

  // Fetched once, unfiltered by band, so the tiles can count the whole set.
  const allRows = await absentMembers({
    branchIds: scope.branchIds,
    minDays: query.minDays,
  })
  const band = query.band ?? null
  const rows = band ? allRows.filter((row) => row.band === band) : allRows

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Absent members</h1>
          <p className="text-sm text-muted-foreground print:hidden">
            Active members who have not trained in {query.minDays} days or more. Longest
            absence first — the top of this list is the churn about to happen. Call them.
          </p>
        </div>
        <Suspense fallback={null}>
          <CsvLink report="absent" />
        </Suspense>
      </div>

      <Suspense>
        <AbsentFilters
          branchId={branchId ?? null}
          minDays={query.minDays}
          band={band}
          branches={branches}
          allowAllBranches={scope.canSwitch}
        />
      </Suspense>

      <AbsentMembersTable
        rows={rows}
        allRows={allRows}
        branchId={branchId ?? null}
        minDays={query.minDays}
        band={band}
      />
    </div>
  )
}
