import Link from 'next/link'
import { Suspense, type ReactNode } from 'react'

import { StatTile } from '@/components/app/stat-tile'
import { AttendanceLogTable } from '@/components/attendance/attendance-log-table'
import { DayRangePicker } from '@/components/attendance/day-range-picker'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { AttendanceDetailRow } from '@/lib/db/attendance'
import type { StaffAttendanceSummary, StaffShiftRow } from '@/lib/db/staff-attendance'
import type { CollectedPaymentRow, TrainerClassRow } from '@/lib/db/staff-activity'
import type { PtSessionListRow } from '@/lib/db/pt'
import { formatDate, formatDateTime, formatMoney, formatTime } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '@/lib/members'

export const ACTIVITY_PAGE_SIZE = 25

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  )
}

function rangeText(on: string, to: string) {
  return on === to ? `on ${formatDate(on)}` : `from ${formatDate(on)} to ${formatDate(to)}`
}

/** Newer / Older links that keep every other filter in the address. */
function Pager({
  page,
  total,
  pageSize,
  hrefFor,
}: {
  page: number
  total: number
  pageSize: number
  hrefFor: (page: number) => string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null

  return (
    <div className="flex items-center justify-between text-sm print:hidden">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className="underline-offset-4 hover:underline">
          ← Newer
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={hrefFor(page + 1)} className="underline-offset-4 hover:underline">
          Older →
        </Link>
      ) : (
        <span />
      )}
    </div>
  )
}

const SHIFT_SOURCE_LABELS: Record<string, string> = {
  card: 'Card',
  offline_card: 'Card (reader was offline)',
  manual: 'Entered by hand',
}

function hoursAndMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`
}

function shiftMinutes(row: StaffShiftRow) {
  if (!row.clocked_out_at) return null
  return Math.max(
    0,
    Math.round((new Date(row.clocked_out_at).getTime() - new Date(row.clocked_in_at).getTime()) / 60000)
  )
}

/**
 * The staff member's own clock-in / clock-out, from card taps at the door. One
 * row per shift; a person can work two in a day. A shift nobody clocked out of
 * is closed by the system without an end time -- shown as such, never as a
 * guessed number of hours.
 */
export function AttendancePanel({
  name,
  rows,
  total,
  summary,
  page,
  on,
  to,
  today,
  showBranch,
  hrefFor,
}: {
  name: string
  rows: StaffShiftRow[]
  total: number
  summary: StaffAttendanceSummary | null
  page: number
  on: string
  to: string
  today: string
  showBranch: boolean
  hrefFor: (page: number) => string
}) {
  const days = summary?.days_in_range ?? 0
  const minutes = summary?.minutes_in_range ?? 0
  const forgotten = summary?.forgotten_shifts_in_range ?? 0
  const hasForgotten = rows.some((row) => row.auto_closed)

  return (
    <div className="flex flex-col gap-4">
      <Suspense>
        <DayRangePicker on={on} to={to} today={today} />
      </Suspense>

      <p className="text-sm text-muted-foreground">
        {name} worked{' '}
        <span className="font-medium text-foreground tabular-nums">
          {days} {days === 1 ? 'day' : 'days'}
        </span>
        {minutes > 0 ? (
          <>
            {', '}
            <span className="font-medium text-foreground tabular-nums">
              {hoursAndMinutes(minutes)}
            </span>{' '}
            in total
          </>
        ) : null}{' '}
        {rangeText(on, to)}.
        {forgotten > 0
          ? ` ${forgotten} ${forgotten === 1 ? 'shift has' : 'shifts have'} no clock-out, so ${
              forgotten === 1 ? 'its time is' : 'their time is'
            } not counted.`
          : ''}
      </p>

      {rows.length === 0 ? (
        <Empty>No clock-ins {rangeText(on, to)}.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>In</TableHead>
                <TableHead>Out</TableHead>
                <TableHead>Time at work</TableHead>
                {showBranch ? <TableHead>Branch</TableHead> : null}
                <TableHead>Reader</TableHead>
                <TableHead>How</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const worked = shiftMinutes(row)
                const open = !row.clocked_out_at && !row.auto_closed
                return (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(row.attended_on)}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatTime(row.clocked_in_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {row.clocked_out_at ? (
                        formatTime(row.clocked_out_at)
                      ) : open ? (
                        <Badge>On shift</Badge>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400">
                          No clock-out recorded
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      {worked === null ? '--' : hoursAndMinutes(worked)}
                    </TableCell>
                    {showBranch ? (
                      <TableCell className="text-muted-foreground">{row.branch_name}</TableCell>
                    ) : null}
                    <TableCell className="text-muted-foreground">{row.device_name ?? '--'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {SHIFT_SOURCE_LABELS[row.in_source] ?? row.in_source}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {hasForgotten ? (
        <p className="text-xs text-muted-foreground">
          &ldquo;No clock-out recorded&rdquo; means they clocked in and never tapped out. After
          16 hours the next tap starts a new shift and closes the old one without an end time,
          because the real time is not known.
        </p>
      ) : null}

      <Pager page={page} total={total} pageSize={ACTIVITY_PAGE_SIZE} hrefFor={hrefFor} />
    </div>
  )
}

export function CheckinsPanel({
  name,
  rows,
  total,
  page,
  on,
  to,
  today,
  showBranch,
  showOut,
  hrefFor,
}: {
  name: string
  rows: AttendanceDetailRow[]
  total: number
  page: number
  on: string
  to: string
  today: string
  showBranch: boolean
  showOut: boolean
  hrefFor: (page: number) => string
}) {
  return (
    <div className="flex flex-col gap-4">
      <Suspense>
        <DayRangePicker on={on} to={to} today={today} />
      </Suspense>
      <p className="text-sm text-muted-foreground">
        Members {name} checked in at the front desk {rangeText(on, to)}:{' '}
        <span className="font-medium text-foreground tabular-nums">{total}</span>. Card taps at
        the door are not counted here, because nobody at the desk did them.
      </p>
      {rows.length === 0 ? (
        <Empty>No desk check-ins {rangeText(on, to)}.</Empty>
      ) : (
        <AttendanceLogTable
          rows={rows}
          showBranch={showBranch}
          showDate={on !== to}
          showOut={showOut}
        />
      )}
      <Pager page={page} total={total} pageSize={ACTIVITY_PAGE_SIZE} hrefFor={hrefFor} />
    </div>
  )
}

const KIND_NOTE: Record<string, string> = {
  refund: 'refund',
  reversal: 'never received',
}

export function PaymentsPanel({
  name,
  rows,
  total,
  sums,
  totalsPartial,
  page,
  on,
  to,
  today,
  showBranch,
  hrefFor,
}: {
  name: string
  rows: CollectedPaymentRow[]
  total: number
  sums: { gross: number; refunds: number; reversals: number; net: number }
  totalsPartial: boolean
  page: number
  on: string
  to: string
  today: string
  showBranch: boolean
  hrefFor: (page: number) => string
}) {
  return (
    <div className="flex flex-col gap-4">
      <Suspense>
        <DayRangePicker on={on} to={to} today={today} />
      </Suspense>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Net collected" value={formatMoney(sums.net)} />
        <StatTile label="Taken in" value={formatMoney(sums.gross)} hint="Before refunds" />
        <StatTile
          label="Paid back"
          value={formatMoney(sums.refunds + sums.reversals)}
          hint="Refunds and payments that never arrived"
        />
      </div>
      {totalsPartial ? (
        <p className="text-sm text-destructive">
          This range has more payments than the totals can add up. Pick a shorter range for
          exact figures.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <Empty>
          {name} did not collect any payments {rangeText(on, to)}.
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Member</TableHead>
                {showBranch ? <TableHead>Branch</TableHead> : null}
                <TableHead>Method</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatDateTime(row.paid_at)}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/members/${row.member_id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.members?.full_name ?? 'Member'}
                    </Link>
                    <span className="block font-mono text-xs text-muted-foreground">
                      {row.members?.member_code}
                    </span>
                  </TableCell>
                  {showBranch ? (
                    <TableCell className="text-muted-foreground">
                      {row.branches?.name ?? '--'}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    {PAYMENT_METHOD_LABELS[row.method]}
                    {KIND_NOTE[row.kind] ? (
                      <span className="ml-1 text-xs text-destructive">{KIND_NOTE[row.kind]}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.reference_no ?? '--'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(row.amount_paisa)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pager page={page} total={total} pageSize={ACTIVITY_PAGE_SIZE} hrefFor={hrefFor} />
    </div>
  )
}

export type TrainerTotals = {
  classes_held: number
  class_hours: number
  seats_available: number
  seats_filled: number
  attended: number
  no_shows: number
  pt_completed: number
  pt_hours: number
}

const PT_STATUS_LABELS: Record<PtSessionListRow['status'], string> = {
  scheduled: 'Booked',
  completed: 'Done',
  cancelled: 'Cancelled',
}

export function TrainerPanel({
  name,
  totals,
  classes,
  sessions,
  on,
  to,
  today,
}: {
  name: string
  totals: TrainerTotals
  classes: TrainerClassRow[]
  sessions: PtSessionListRow[]
  on: string
  to: string
  today: string
}) {
  const fill =
    totals.seats_available > 0
      ? `${Math.round((totals.seats_filled / totals.seats_available) * 100)}%`
      : '--'

  return (
    <div className="flex flex-col gap-6">
      <Suspense>
        <DayRangePicker on={on} to={to} today={today} />
      </Suspense>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Classes taught"
          value={String(totals.classes_held)}
          hint={`${totals.class_hours} hours`}
        />
        <StatTile
          label="Seats filled"
          value={fill}
          hint={`${totals.seats_filled} of ${totals.seats_available} seats`}
        />
        <StatTile
          label="Came to class"
          value={String(totals.attended)}
          hint={`${totals.no_shows} did not show`}
        />
        <StatTile
          label="Personal training"
          value={String(totals.pt_completed)}
          hint={`sessions done, ${totals.pt_hours} hours`}
        />
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Classes</h3>
        {classes.length === 0 ? (
          <Empty>
            {name} has no classes {rangeText(on, to)}.
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Starts</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Booked</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {classes.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatDateTime(row.starts_at)}
                    </TableCell>
                    <TableCell>
                      {row.classes?.name ?? 'Class'}
                      {row.classes?.room ? (
                        <span className="block text-xs text-muted-foreground">
                          {row.classes.room}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.booked_count} / {row.capacity}
                    </TableCell>
                    <TableCell>
                      {row.status === 'cancelled' ? (
                        <Badge variant="secondary">Cancelled</Badge>
                      ) : (
                        <span className="text-muted-foreground">Scheduled</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Personal training sessions</h3>
        {sessions.length === 0 ? (
          <Empty>
            {name} has no personal training sessions {rangeText(on, to)}.
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Length</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatDateTime(row.scheduled_at)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/members/${row.member_id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {row.members?.full_name ?? 'Member'}
                      </Link>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {row.members?.member_code}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">{row.duration_minutes} min</TableCell>
                    <TableCell>
                      <Badge variant={row.status === 'cancelled' ? 'secondary' : 'outline'}>
                        {PT_STATUS_LABELS[row.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  )
}
