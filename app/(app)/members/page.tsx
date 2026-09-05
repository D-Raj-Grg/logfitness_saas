import Link from 'next/link'

import { MemberSearch } from '@/components/members/member-search'
import { MembersTable } from '@/components/members/members-table'
import { Pagination } from '@/components/members/pagination'
import { Button } from '@/components/ui/button'
import { requireRole } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'
import { listMembers } from '@/lib/db/members'
import { memberPhotoUrls } from '@/lib/db/photos'
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
  const parsed = memberListQuerySchema.safeParse({
    q: first(raw.q),
    status: first(raw.status) || undefined,
    branchId: first(raw.branchId) || undefined,
    page: first(raw.page),
    pageSize: first(raw.pageSize),
  })
  // A hand-edited URL should not 500 the front desk; fall back to defaults.
  const query = parsed.success ? parsed.data : memberListQuerySchema.parse({})

  const [result, allBranches] = await Promise.all([listMembers(query), listBranches()])

  // One signing round trip for the page, not one per row.
  const photoUrls = await memberPhotoUrls(result.rows.map((row) => row.photo_path))

  // Non-owners only see their own branches in the filter; RLS already scopes
  // the rows themselves.
  const branches =
    staff.role === 'owner'
      ? allBranches
      : allBranches.filter((branch) => staff.branchIds.includes(branch.id))

  const filtered = Boolean(query.q || query.status || query.branchId)

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

      <MemberSearch
        q={query.q}
        status={query.status}
        branchId={query.branchId}
        branches={branches}
      />

      <MembersTable rows={result.rows} filtered={filtered} photoUrls={photoUrls} />

      <Pagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        params={{
          q: query.q || undefined,
          status: query.status,
          branchId: query.branchId,
          pageSize: first(raw.pageSize),
        }}
      />
    </div>
  )
}
