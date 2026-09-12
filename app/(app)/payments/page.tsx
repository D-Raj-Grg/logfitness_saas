import { Suspense } from 'react'

import { TableSkeleton } from '@/components/app/skeletons'
import { ArrearsTable } from '@/components/payments/arrears-table'
import { CollectionSheet } from '@/components/payments/collection-sheet'
import { PaymentsFilters, type PaymentsView } from '@/components/payments/payments-filters'
import { CsvLink } from '@/components/reports/csv-link'
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

    return (
      <div className="flex flex-col gap-6">
        <PageHeading
          title="Arrears"
          description="Who owes money, and for how long. Oldest debts first."
          report="arrears"
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
        <Suspense
          key={`arrears:${bucket ?? 'all'}:${scope.label}`}
          fallback={<TableSkeleton rows={10} columns={7} />}
        >
          <Arrears branchIds={scope.branchIds} bucket={bucket} />
        </Suspense>
      </div>
    )
  }

  const query = collectionQuerySchema.safeParse({
    on: first(params.on),
    branchId: branchId ?? undefined,
  })
  const on = (query.success && query.data.on) || todayInTimezone()

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Daily collection"
        description="The drawer sheet: what each person took, by method, net of refunds."
        report="collection"
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
      <Suspense
        key={`collection:${on}:${scope.label}`}
        fallback={<TableSkeleton rows={10} columns={6} />}
      >
        <Collection on={on} branchIds={scope.branchIds} />
      </Suspense>
    </div>
  )
}

/**
 * The two report bodies. Both are a single slow query with nothing above them
 * that depends on it, so they read it here and let the heading and the filter
 * bar flush first -- the controls are usable while the numbers are still coming.
 */
async function Arrears({
  branchIds,
  bucket,
}: {
  branchIds: string[] | null
  bucket: string | null
}) {
  const allRows = await arrearsReport(branchIds)
  const rows = bucket ? allRows.filter((row) => row.bucket === bucket) : allRows
  return <ArrearsTable rows={rows} allRows={allRows} />
}

async function Collection({
  on,
  branchIds,
}: {
  on: string
  branchIds: string[] | null
}) {
  const rows = await dailyCollection({ on, branchIds })
  return <CollectionSheet rows={rows} on={on} />
}

function PageHeading({
  title,
  description,
  report,
}: {
  title: string
  description: string
  /** Which /api/reports/<report>/csv this screen exports as. */
  report: string
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground print:hidden">{description}</p>
      </div>
      <Suspense fallback={null}>
        <CsvLink report={report} />
      </Suspense>
    </div>
  )
}
