import Link from 'next/link'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ATTENDANCE_METHOD_LABELS } from '@/lib/attendance'
import type { AttendanceDetailRow } from '@/lib/db/attendance'
import { formatMoney, formatTime } from '@/lib/format'

/**
 * The day's log at this branch. Read top to bottom it is the shift handover:
 * who came, when, how they were identified, and who let them in.
 */
export function AttendanceLogTable({
  rows,
  showBranch,
}: {
  rows: AttendanceDetailRow[]
  /** Owners looking at every branch need the column; a single branch does not. */
  showBranch: boolean
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
        <p className="text-sm font-medium">No check-ins yet</p>
        <p className="text-sm text-muted-foreground">
          The first arrival of the day will show up here.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">In</TableHead>
            <TableHead className="w-24">Out</TableHead>
            <TableHead>Member</TableHead>
            {showBranch ? <TableHead>Branch</TableHead> : null}
            <TableHead>Method</TableHead>
            <TableHead>Checked in by</TableHead>
            <TableHead className="text-right">Dues then</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap tabular-nums">
                {formatTime(row.checked_in_at)}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                {row.checked_out_at ? formatTime(row.checked_out_at) : '--'}
              </TableCell>
              <TableCell>
                <Link
                  href={`/members/${row.member_id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {row.full_name}
                </Link>
                <span className="block font-mono text-xs text-muted-foreground">
                  {row.member_code}
                </span>
              </TableCell>
              {showBranch ? (
                <TableCell className="text-muted-foreground">{row.branch_name}</TableCell>
              ) : null}
              <TableCell>
                <span className="block">{ATTENDANCE_METHOD_LABELS[row.method]}</span>
                {row.is_override ? (
                  <span className="block text-xs text-amber-700 dark:text-amber-400">
                    Override{row.override_reason ? ` — ${row.override_reason}` : ''}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.checked_in_by_name ?? '--'}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.due_paisa_at_checkin > 0 ? (
                  <span className="font-medium text-destructive">
                    {formatMoney(row.due_paisa_at_checkin)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">--</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
