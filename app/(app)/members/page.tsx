import Link from 'next/link'

import { Pagination } from '@/components/app/pagination'
import { MemberSearch } from '@/components/members/member-search'
import { MembersTable } from '@/components/members/members-table'
import { Button } from '@/components/ui/button'
import { requireRole } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'
import { listMembers } from '@/lib/db/members'
import { memberPhotoUrls } from '@/lib/db/photos'
import { resolveBranchScope } from '@/lib/scope'
import { memberListQuerySchema } from '@/lib/validation/members'

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const staff = await requireRole('owner', 'manager', 'front_desk')

  const raw = await searchParams
  const scope = await resolveBranchScope(raw, staff)

  const parsed = memberListQuerySchema.safeParse({
    q: first(raw.q),
    status: first(raw.status) || undefined,
    sort: first(raw.sort) || undefined,
    dir: first(raw.dir) || undefined,
    page: first(raw.page),
    pageSize: first(raw.pageSize),
  })
  // A hand-edited URL should not 500 the front desk; fall back to defaults.
  const query = parsed.success ? parsed.data : memberListQuerySchema.parse({})

  // The header switcher is the only way to say which branches to look at --
  // there used to be a second, page-local branch filter here too, but two
  // controls that can disagree (`?branch=` vs `?branchId=`) is worse than one.
  const result = await listMembers(query, scope.branchIds)

  // One signing round trip for the page, not one per row.
  const photoUrls = await memberPhotoUrls(result.rows.map((row) => row.photo_path))

  // The quick-edit dialog's branch picker. One query for the page, shared by
  // every row. requireRole above has already kept trainers off this screen,
  // so everyone who gets here may edit.
  const allBranches = await listBranches()
  const branches =
    staff.role === 'owner'
      ? allBranches
      : allBranches.filter((branch) => staff.branchIds.includes(branch.id))

  // Carried into both the sort links and the pager, so neither drops the
  // other's state.
  const listParams = {
    q: query.q || undefined,
    status: query.status,
    sort: query.sort,
    dir: query.dir,
    // Preserved so Prev/Next don't silently drop the header's branch
    // scope back to the default.
    branch: first(raw.branch),
    pageSize: first(raw.pageSize),
  }

  const filtered = Boolean(query.q || query.status)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Members</h1>
          <p className="text-sm text-muted-foreground">
            Everyone registered at {staff.orgName}, across every branch.
          </p>
        </div>
        <Button render={<Link href="/members/new" />}>Register member</Button>
      </div>

      <MemberSearch q={query.q} status={query.status} />

      <MembersTable
        rows={result.rows}
        filtered={filtered}
        photoUrls={photoUrls}
        sort={query.sort}
        dir={query.dir}
        params={listParams}
        startIndex={(result.page - 1) * result.pageSize}
        branches={branches}
        isOwner={staff.role === 'owner'}
      />

      <Pagination
        basePath="/members"
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        params={listParams}
      />
    </div>
  )
}
