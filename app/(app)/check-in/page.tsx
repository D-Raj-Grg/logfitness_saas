import { Suspense } from 'react'

import { AttendanceLogTable } from '@/components/attendance/attendance-log-table'
import { BranchPicker } from '@/components/attendance/branch-picker'
import { CheckInConsole } from '@/components/attendance/check-in-console'
import { InGymNow } from '@/components/attendance/in-gym-now'
import { Card, CardContent } from '@/components/ui/card'
import { requireStaff } from '@/lib/auth'
import { attendanceDaySummary, inGymNow, listAttendance } from '@/lib/db/attendance'
import { listBranches } from '@/lib/db/branches'
import { memberPhotoUrls } from '@/lib/db/photos'

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </CardContent>
    </Card>
  )
}

export default async function CheckInPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  // Every role may watch the desk -- the nav shows it to trainers too -- but
  // only the desk roles may write, and the RPC refuses the rest anyway.
  const staff = await requireStaff()
  const params = await searchParams

  const isOwner = staff.role === 'owner'
  const canCheckIn =
    staff.role === 'owner' || staff.role === 'manager' || staff.role === 'front_desk'

  const allBranches = await listBranches()
  const branches = isOwner
    ? allBranches
    : allBranches.filter((branch) => staff.branchIds.includes(branch.id))

  // A branch outside the caller's scope is dropped rather than rejected: RLS
  // would return nothing for it anyway, and a stale link should still render.
  const requested = first(params.branch)
  const scoped =
    requested && branches.some((branch) => branch.id === requested) ? requested : undefined
  const branchId = isOwner ? scoped : (scoped ?? branches[0]?.id)

  const branchIds = branchId ? [branchId] : null

  const [inGym, summary, log] = await Promise.all([
    inGymNow(branchIds),
    attendanceDaySummary({ branchIds }),
    listAttendance({ branchId, page: 1, pageSize: 25 }),
  ])

  // One signing round trip for the whole roster, not one per row.
  const photoUrls = await memberPhotoUrls(inGym.map((row) => row.photo_path))

  const checkIns = summary.reduce((total, row) => total + row.check_ins, 0)
  const distinctMembers = summary.reduce((total, row) => total + row.distinct_members, 0)
  const branchName = branchId
    ? (branches.find((branch) => branch.id === branchId)?.name ?? null)
    : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Check-in</h1>
          <p className="text-sm text-muted-foreground">
            {branchName
              ? `The front desk at ${branchName}.`
              : 'The front desk, across every branch.'}
          </p>
        </div>
        {branches.length > 1 ? (
          <Suspense>
            <BranchPicker
              branchId={branchId ?? null}
              branches={branches}
              allowAllBranches={isOwner}
            />
          </Suspense>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Check-ins today" value={String(checkIns)} />
        <StatTile
          label="Distinct members"
          value={String(distinctMembers)}
          hint={summary.length > 1 ? 'Summed across branches' : undefined}
        />
        <StatTile label="In the gym now" value={String(inGym.length)} hint="Not yet checked out" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {canCheckIn ? (
            <CheckInConsole branchId={branchId ?? null} branchName={branchName} />
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
              <p className="text-sm font-medium">View only</p>
              <p className="text-sm text-muted-foreground">
                Trainers can see who is in the gym, but check-ins are recorded by the
                front desk.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 lg:col-span-1">
          <h2 className="text-sm font-medium">In the gym now</h2>
          <InGymNow rows={inGym} photoUrls={photoUrls} canCheckOut={canCheckIn} />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Latest check-ins</h2>
          <p className="text-sm text-muted-foreground">
            The 25 most recent arrivals{branchName ? ` at ${branchName}` : ''}.
          </p>
        </div>
        <AttendanceLogTable rows={log.rows} showBranch={!branchId} />
      </div>
    </div>
  )
}
