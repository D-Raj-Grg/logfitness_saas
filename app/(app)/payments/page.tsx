import { Suspense } from 'react'

import { TableSkeleton } from '@/components/app/skeletons'
import { ArrearsTable } from '@/components/payments/arrears-table'
import { CollectionSheet } from '@/components/payments/collection-sheet'
import { PaymentsFilters, type PaymentsView } from '@/components/payments/payments-filters'
import { CsvLink } from '@/components/reports/csv-link'
import { requireRole } from '@/lib/auth'
import {
  arrearsReport,
  dailyCollection,
  dailyCollectionDetail,
  dailyCollectionSummary,
} from '@/lib/db/payments'
import { discountReport } from '@/lib/db/reports'
import { addDays, todayInTimezone } from '@/lib/format'
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
          reports={[{ report: 'arrears', label: 'Export CSV' }]}
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
        description="The drawer sheet: what came in, what went back out, and who it came from."
        reports={[
          { report: 'collection', label: 'Export CSV' },
          { report: 'collection-detail', label: 'Export detail CSV' },
        ]}
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
  // Five single-day, index-covered queries in parallel. Yesterday is a second
  // call of the same function rather than a parameter on it: the function stays
  // one question, and the CSV route -- which shows no comparison -- does not
  // pay for one. addDays does UTC-safe string maths; new Date(on) would slide
  // the day backwards in an evening timezone.
  const [rows, summaries, previousSummaries, detail, discounts] = await Promise.all([
    dailyCollection({ on, branchIds }),
    dailyCollectionSummary({ on, branchIds }),
    dailyCollectionSummary({ on: addDays(on, -1), branchIds }),
    dailyCollectionDetail({ on, branchIds }),
    discountReport({ branchIds, from: on, to: on }),
  ])

  // The totals row is the one with no branch on it.
  const totals = summaries.find((row) => row.branch_id === null) ?? null
  const previousTotals = previousSummaries.find((row) => row.branch_id === null) ?? null

  return (
    <CollectionSheet
      rows={rows}
      detail={detail}
      summary={totals}
      previous={previousTotals}
      discounts={discounts}
      on={on}
    />
  )
}

function PageHeading({
  title,
  description,
  reports,
}: {
  title: string
  description: string
  /**
   * The /api/reports/<report>/csv endpoints this screen exports as. Collection
   * has two: the grouped sheet, and the line-by-line file an accountant
   * reconciles against a bank statement.
   */
  reports: { report: string; label: string }[]
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground print:hidden">{description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4 print:hidden">
        {reports.map((entry) => (
          <Suspense key={entry.report} fallback={null}>
            <CsvLink report={entry.report} label={entry.label} />
          </Suspense>
        ))}
      </div>
    </div>
  )
}
