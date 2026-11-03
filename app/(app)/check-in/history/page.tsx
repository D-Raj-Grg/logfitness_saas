import Link from 'next/link'
import { Suspense } from 'react'

import { AttendanceLogTable } from '@/components/attendance/attendance-log-table'
import { BranchPicker } from '@/components/attendance/branch-picker'
import { DayRangePicker } from '@/components/attendance/day-range-picker'
import { Card, CardContent } from '@/components/ui/card'
import { requireStaff } from '@/lib/auth'
import { listAttendance } from '@/lib/db/attendance'
import { formatDate, todayInTimezone } from '@/lib/format'
import { resolveBranchScope } from '@/lib/scope'
import { attendanceLogQuerySchema } from '@/lib/validation/attendance'

const PAGE_SIZE = 50

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Who came on a given day (or run of days). Reached by clicking a date in the
 * Attendance report, or from the check-in screen. Each name opens the member.
 */
export default async function AttendanceHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const staff = await requireStaff()
  const params = await searchParams
  const scope = await resolveBranchScope(params, staff)

  const today = todayInTimezone()
  const parsed = attendanceLogQuerySchema.safeParse({
    on: first(params.on),
    to: first(params.to),
    page: first(params.page),
    pageSize: PAGE_SIZE,
  })

  let on = (parsed.success && parsed.data.on) || today
  let to = (parsed.success && parsed.data.to) || on
  // A backwards range is a typo, not a question.
  if (on > to) [on, to] = [to, on]
  const requestedPage = parsed.success ? parsed.data.page : 1

  const branchId = scope.options.length === 1 ? scope.options[0].id : scope.selectedId

  const log = await listAttendance({
    branchId: branchId ?? undefined,
    branchIds: scope.branchIds ?? undefined,
    on,
    to,
    page: requestedPage,
    pageSize: PAGE_SIZE,
  })
  // A page past the end comes back as the last real page.
  const page = log.page

  const people = new Set(log.rows.map((row) => row.member_id)).size
  const pages = Math.max(1, Math.ceil(log.total / PAGE_SIZE))
  const rangeLabel = on === to ? formatDate(on) : `${formatDate(on)} – ${formatDate(to)}`

  function pageHref(target: number) {
    const query = new URLSearchParams()
    query.set('on', on)
    if (to !== on) query.set('to', to)
    const branch = first(params.branch)
    if (branch) query.set('branch', branch)
    if (target > 1) query.set('page', String(target))
    return `/check-in/history?${query.toString()}`
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/check-in"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline print:hidden"
          >
            ← Back to check-in
          </Link>
          <h1 className="text-2xl font-semibold">Who came: {rangeLabel}</h1>
          <p className="text-sm text-muted-foreground print:hidden">
            {branchId ? `At ${scope.label}.` : 'Across every branch you cover.'} Click a name to open
            the member.
          </p>
        </div>
        {scope.canSwitch ? (
          <Suspense>
            <BranchPicker
              branchId={branchId ?? null}
              branches={scope.options}
              allowAllBranches={scope.canSwitch}
            />
          </Suspense>
        ) : null}
      </div>

      <Suspense>
        <DayRangePicker on={on} to={to} today={today} />
      </Suspense>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="flex flex-col gap-1 py-4">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Check-ins
            </span>
            <span className="text-2xl font-semibold tabular-nums">{log.total}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 py-4">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Different members{pages > 1 ? ' on this page' : ''}
            </span>
            <span className="text-2xl font-semibold tabular-nums">{people}</span>
          </CardContent>
        </Card>
      </div>

      {log.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nobody checked in {on === to ? `on ${formatDate(on)}` : `from ${formatDate(on)} to ${formatDate(to)}`}.
        </p>
      ) : (
        <AttendanceLogTable rows={log.rows} showBranch={!branchId} showDate={on !== to} />
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-between text-sm print:hidden">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="underline-offset-4 hover:underline">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} className="underline-offset-4 hover:underline">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </div>
  )
}
