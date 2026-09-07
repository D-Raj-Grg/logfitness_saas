import { Pagination } from '@/components/app/pagination'
import { VisitorFilters } from '@/components/visitors/visitor-filters'
import {
  NewVisitorButton,
  type VisitorFormContext,
} from '@/components/visitors/visitor-dialog'
import { VisitorsTable } from '@/components/visitors/visitors-table'
import { requireStaff } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'
import { listPlans } from '@/lib/db/plans'
import { listVisitors, type VisitorStatus } from '@/lib/db/visitors'
import { todayInTimezone } from '@/lib/format'
import { resolveBranchScope } from '@/lib/scope'
import {
  visitorListQuerySchema,
  type VisitorListQuery,
} from '@/lib/validation/visitors'

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

const VIEWS: Record<VisitorListQuery['view'], VisitorStatus | 'open' | undefined> = {
  open: 'open',
  all: undefined,
  converted: 'converted',
  lost: 'lost',
}

export default async function VisitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  // Every role: a walk-in asks whoever is standing there, trainers included.
  const staff = await requireStaff()
  const raw = await searchParams

  const scope = await resolveBranchScope(raw, staff)

  // A hand-edited URL should not 500 the desk: every field falls back rather
  // than throwing, the same way the members list reads its query.
  const parsed = visitorListQuerySchema.safeParse({
    view: first(raw.view),
    kind: first(raw.kind),
    q: first(raw.q),
    page: first(raw.page),
    pageSize: first(raw.pageSize),
  })
  const query = parsed.success ? parsed.data : visitorListQuerySchema.parse({})

  const [result, branches, plans] = await Promise.all([
    listVisitors({
      branchIds: scope.branchIds,
      status: VIEWS[query.view],
      kind: query.kind === 'all' ? undefined : query.kind,
      q: query.q,
      page: query.page,
      pageSize: query.pageSize,
    }),
    listBranches(),
    listPlans(),
  ])

  const branchNames = Object.fromEntries(branches.map((branch) => [branch.id, branch.name]))
  const planNames = Object.fromEntries(plans.map((plan) => [plan.id, plan.name]))

  // The dialog offers only branches the caller may actually log a visitor at --
  // RLS refuses the rest, and an option that always fails is not an option.
  const writableBranches =
    staff.role === 'owner'
      ? branches
      : branches.filter((branch) => staff.branchIds.includes(branch.id))

  const context: VisitorFormContext = {
    branches: writableBranches.map(({ id, name }) => ({ id, name })),
    plans: plans
      .filter((plan) => plan.is_active)
      .map(({ id, name, branch_ids }) => ({ id, name, branch_ids })),
    defaultBranchId: scope.selectedId ?? writableBranches[0]?.id,
    today: todayInTimezone(),
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Visitors</h1>
          <p className="text-sm text-muted-foreground">
            Everyone who walked in without a membership — an enquiry to call back,
            or a guest who trained for the day.
          </p>
        </div>
        <NewVisitorButton context={context} />
      </div>

      <VisitorFilters view={query.view} kind={query.kind} q={query.q} />

      <VisitorsTable
        rows={result.rows}
        branchNames={branchNames}
        planNames={planNames}
        canDelete={staff.role === 'owner'}
      />

      <Pagination
        basePath="/visitors"
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        params={{
          // Everything the filters own, so Prev/Next do not quietly reset the
          // list to the default view.
          view: query.view === 'open' ? undefined : query.view,
          kind: query.kind === 'all' ? undefined : query.kind,
          q: query.q || undefined,
          branch: first(raw.branch),
          pageSize: first(raw.pageSize),
        }}
      />
    </div>
  )
}
