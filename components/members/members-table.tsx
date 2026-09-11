import Link from 'next/link'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'

import { MemberPhoto } from '@/components/members/member-photo'
import { MemberRowActions } from '@/components/members/member-row-actions'
import { MemberStatusBadge } from '@/components/members/member-status-badge'
import type { QuickEditBranch } from '@/components/members/member-quick-edit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { MemberOverviewRow } from '@/lib/db/members'
import { formatDate, formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { MemberSort, MemberSortDir } from '@/lib/validation/members'

/** The direction each column opens on: the answer people are looking for. */
const FIRST_DIR: Record<MemberSort, MemberSortDir> = {
  code: 'desc',
  name: 'asc',
  dues: 'desc',
  expiry: 'asc',
}

/**
 * Sorting is URL state, so the table stays a Server Component and a sorted
 * view is a link someone can send to the next shift.
 */
function sortHref(
  column: MemberSort,
  sort: MemberSort,
  dir: MemberSortDir,
  params: Record<string, string | undefined>
) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value)
  }
  // Clicking the column you are already on turns it around; a new column
  // starts the way that column is usually read. Either way the offset goes:
  // page 3 of the old order says nothing about the new one.
  const next = sort === column ? (dir === 'asc' ? 'desc' : 'asc') : FIRST_DIR[column]
  query.set('sort', column)
  query.set('dir', next)
  query.delete('page')
  return `/members?${query.toString()}`
}

function SortHeader({
  column,
  label,
  sort,
  dir,
  params,
}: {
  column: MemberSort
  label: string
  sort: MemberSort
  dir: MemberSortDir
  params: Record<string, string | undefined>
}) {
  const active = sort === column
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <Link
      href={sortHref(column, sort, dir, params)}
      aria-label={`Sort by ${label}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm underline-offset-4 hover:underline',
        active ? 'text-foreground' : 'text-muted-foreground'
      )}
    >
      {label}
      <Icon className="size-3.5" aria-hidden />
    </Link>
  )
}

export function MembersTable({
  rows,
  filtered,
  photoUrls,
  sort,
  dir,
  params,
  startIndex,
  branches,
  isOwner,
}: {
  rows: MemberOverviewRow[]
  /** True when a search term or filter is applied, so the empty copy fits. */
  filtered: boolean
  /** Signed URLs keyed by storage path, minted once for the whole page. */
  photoUrls: Record<string, string>
  sort: MemberSort
  dir: MemberSortDir
  /** Current query, so a sort click keeps the search, filter and branch scope. */
  params: Record<string, string | undefined>
  /** Rows before this page, so the serial number carries across pagination. */
  startIndex: number
  /** Branches the viewer may move a member into; the row adds the member's own. */
  branches: QuickEditBranch[]
  isOwner: boolean
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
        {filtered ? (
          <>
            <p className="text-sm font-medium">No members match</p>
            <p className="text-sm text-muted-foreground">
              Try a shorter phone prefix or clear the filters.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">No members yet</p>
            <p className="text-sm text-muted-foreground">
              Register the first member and they will show up here.
            </p>
          </>
        )}
        <Button variant="outline" size="sm" render={<Link href="/members/new" />}>
          Register a member
        </Button>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12 text-right">#</TableHead>
            <TableHead className="w-28">
              <SortHeader column="code" label="Code" sort={sort} dir={dir} params={params} />
            </TableHead>
            <TableHead>
              <SortHeader column="name" label="Name" sort={sort} dir={dir} params={params} />
            </TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>
              <SortHeader column="expiry" label="Plan" sort={sort} dir={dir} params={params} />
            </TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">
              <SortHeader column="dues" label="Dues" sort={sort} dir={dir} params={params} />
            </TableHead>
            <TableHead className="w-12" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={row.id}>
              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                {startIndex + index + 1}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {row.member_code}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <MemberPhoto
                    url={row.photo_path ? (photoUrls[row.photo_path] ?? null) : null}
                    name={row.full_name}
                    className="size-8 text-[10px]"
                  />
                  <Link
                    href={`/members/${row.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.full_name}
                  </Link>
                </div>
              </TableCell>
              <TableCell className="tabular-nums">{row.phone}</TableCell>
              <TableCell>
                {row.current_plan_name ? (
                  <>
                    <span className="block">{row.current_plan_name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {row.membership_end_date
                        ? `Ends ${formatDate(row.membership_end_date)}`
                        : row.sessions_remaining !== null
                          ? `${row.sessions_remaining} sessions left`
                          : 'No end date'}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">No plan</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5">
                  <MemberStatusBadge
                    status={row.status}
                    daysToExpiry={row.days_to_expiry}
                    membershipStatus={row.membership_status}
                    hasMembershipHistory={row.has_membership_history ?? true}
                  />
                  {/* Only ever seen under the Archived filter, where it says why
                      these rows are missing from every other view. */}
                  {row.archived_at ? <Badge variant="outline">Archived</Badge> : null}
                </div>
              </TableCell>
              <TableCell
                className={cn(
                  'text-right tabular-nums',
                  row.due_paisa > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'
                )}
              >
                {row.due_paisa > 0 ? formatMoney(row.due_paisa) : '--'}
              </TableCell>
              <TableCell className="text-right">
                <MemberRowActions
                  row={row}
                  // The member's own branch stays on the list even when the
                  // viewer cannot register into it, so an unrelated correction
                  // does not force a branch move.
                  branches={
                    branches.some((branch) => branch.id === row.home_branch_id)
                      ? branches
                      : [
                          ...branches,
                          { id: row.home_branch_id, name: row.home_branch_name },
                        ]
                  }
                  isOwner={isOwner}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
