import Link from 'next/link'

import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { orgSnapshot } from '@/lib/db/reports'
import { formatMoney } from '@/lib/format'

type SnapshotRow = Awaited<ReturnType<typeof orgSnapshot>>[number]
/** A per-branch row -- the totals row (branch_id null) is never passed here. */
type Row = SnapshotRow & { branch_id: string; branch_name: string }

/**
 * One row per branch, every cell a link into the screen that already shows
 * that detail. This table only appears when there is more than one branch to
 * compare -- a single branch already has the tiles above it.
 */
export function BranchTable({ rows }: { rows: Row[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Branch</TableHead>
              <TableHead className="text-right">Active</TableHead>
              <TableHead className="text-right">Collected today</TableHead>
              <TableHead className="text-right">Check-ins</TableHead>
              <TableHead className="text-right">Expiring</TableHead>
              <TableHead className="text-right">Dues</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.branch_id}>
                <TableCell className="font-medium">{row.branch_name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  <Link
                    href={`/members?branch=${row.branch_id}&status=active`}
                    className="hover:underline"
                  >
                    {row.active_members}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Link
                    href={`/payments?view=collection&branch=${row.branch_id}`}
                    className="hover:underline"
                  >
                    {formatMoney(row.collected_today_paisa)}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Link href={`/check-in?branch=${row.branch_id}`} className="hover:underline">
                    {row.check_ins_today}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Link
                    href={`/members?branch=${row.branch_id}&status=expiring`}
                    className="hover:underline"
                  >
                    {row.expiring_7d}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Link
                    href={`/payments?view=arrears&branch=${row.branch_id}`}
                    className="hover:underline"
                  >
                    {formatMoney(row.dues_paisa)}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
