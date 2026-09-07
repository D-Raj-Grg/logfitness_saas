import { Suspense } from 'react'

import { ArrearsTable } from '@/components/payments/arrears-table'
import { CollectionSheet } from '@/components/payments/collection-sheet'
import { PaymentsFilters, type PaymentsView } from '@/components/payments/payments-filters'
import { requireRole } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'
import { arrearsReport, dailyCollection } from '@/lib/db/payments'
import { DEFAULT_TIMEZONE } from '@/lib/format'
import { arrearsQuerySchema, collectionQuerySchema } from '@/lib/validation/payments'

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

/** Today at the front desk, not on the server. */
function todayInKathmandu() {
  return new Date().toLocaleDateString('en-CA', { timeZone: DEFAULT_TIMEZONE })
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireRole('owner', 'manager', 'front_desk')
  const params = await searchParams

  const view: PaymentsView = first(params.view) === 'arrears' ? 'arrears' : 'collection'

  const allBranches = await listBranches()
  const isOwner = staff.role === 'owner'
  const branches = isOwner
    ? allBranches
    : allBranches.filter((branch) => staff.branchIds.includes(branch.id))

  // A branch outside the caller's scope is dropped rather than rejected: RLS
  // would return nothing for it anyway, and a stale link should still render.
  const requestedBranch = first(params.branch)
  const scopedBranch =
    requestedBranch && branches.some((branch) => branch.id === requestedBranch)
      ? requestedBranch
      : undefined
  const branchId = isOwner ? scopedBranch : (scopedBranch ?? branches[0]?.id)

  if (view === 'arrears') {
    const query = arrearsQuerySchema.safeParse({
      branchId,
      bucket: first(params.bucket),
    })
    const bucket = query.success ? (query.data.bucket ?? null) : null

    const allRows = await arrearsReport(branchId ? [branchId] : null)
    const rows = bucket ? allRows.filter((row) => row.bucket === bucket) : allRows

    return (
      <div className="flex flex-col gap-6">
        <PageHeading
          title="Arrears"
          description="Who owes money, and for how long. Oldest debts first."
        />
        <Suspense>
          <PaymentsFilters
            view={view}
            on={todayInKathmandu()}
            branchId={branchId ?? null}
            bucket={bucket}
            branches={branches}
            allowAllBranches={isOwner}
          />
        </Suspense>
        <ArrearsTable rows={rows} allRows={allRows} />
      </div>
    )
  }

  const query = collectionQuerySchema.safeParse({ on: first(params.on), branchId })
  const on = (query.success && query.data.on) || todayInKathmandu()

  const rows = await dailyCollection({ on, branchIds: branchId ? [branchId] : null })

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Daily collection"
        description="The drawer sheet: what each person took, by method, net of refunds."
      />
      <Suspense>
        <PaymentsFilters
          view={view}
          on={on}
          branchId={branchId ?? null}
          bucket={null}
          branches={branches}
          allowAllBranches={isOwner}
        />
      </Suspense>
      <CollectionSheet rows={rows} on={on} />
    </div>
  )
}

function PageHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground print:hidden">{description}</p>
    </div>
  )
}
