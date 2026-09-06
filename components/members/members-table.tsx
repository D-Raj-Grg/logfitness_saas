import Link from 'next/link'

import { MemberPhoto } from '@/components/members/member-photo'
import { MemberStatusBadge } from '@/components/members/member-status-badge'
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

export function MembersTable({
  rows,
  filtered,
  photoUrls,
}: {
  rows: MemberOverviewRow[]
  /** True when a search term or filter is applied, so the empty copy fits. */
  filtered: boolean
  /** Signed URLs keyed by storage path, minted once for the whole page. */
  photoUrls: Record<string, string>
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
            <TableHead className="w-28">Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Branch</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Dues</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
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
              <TableCell className="text-muted-foreground">{row.home_branch_name}</TableCell>
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
                <MemberStatusBadge
                  status={row.status}
                  daysToExpiry={row.days_to_expiry}
                  membershipStatus={row.membership_status}
                  hasMembershipHistory={row.has_membership_history ?? true}
                />
              </TableCell>
              <TableCell
                className={cn(
                  'text-right tabular-nums',
                  row.due_paisa > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'
                )}
              >
                {row.due_paisa > 0 ? formatMoney(row.due_paisa) : '--'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
