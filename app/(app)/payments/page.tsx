import { Suspense } from 'react'

import { ArrearsTable } from '@/components/payments/arrears-table'
import { CollectionSheet } from '@/components/payments/collection-sheet'
import { PaymentsFilters, type PaymentsView } from '@/components/payments/payments-filters'
import { requireRole } from '@/lib/auth'
import { arrearsReport, dailyCollection } from '@/lib/db/payments'
import { todayInTimezone } from '@/lib/format'
import { resolveBranchScope } from '@/lib/scope'
import { arrearsQuerySchema, collectionQuerySchema } from '@/lib/validation/payments'

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireRole('owner', 'manager', 'front_desk')
  const params = await searchParams

  const view: PaymentsView = first(params.view) === 'arrears' ? 'arrears' : 'collection'

  const scope = await resolveBranchScope(params, staff)
  const branchId = scope.selectedId

  if (view === 'arrears') {
    const query = arrearsQuerySchema.safeParse({
      branchId: branchId ?? undefined,
      bucket: first(params.bucket),
    })
    const bucket = query.success ? (query.data.bucket ?? null) : null

    const allRows = await arrearsReport(scope.branchIds)
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
            on={todayInTimezone()}
            branchId={branchId}
            bucket={bucket}
            branches={scope.options}
            allowAllBranches={scope.canSwitch}
          />
        </Suspense>
        <ArrearsTable rows={rows} allRows={allRows} />
      </div>
    )
  }

  const query = collectionQuerySchema.safeParse({
    on: first(params.on),
    branchId: branchId ?? undefined,
  })
  const on = (query.success && query.data.on) || todayInTimezone()

  const rows = await dailyCollection({ on, branchIds: scope.branchIds })

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
          branchId={branchId}
          bucket={null}
          branches={scope.options}
          allowAllBranches={scope.canSwitch}
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
