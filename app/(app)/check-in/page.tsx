import { Suspense } from 'react'

import { AttendanceLogTable } from '@/components/attendance/attendance-log-table'
import { BranchPicker } from '@/components/attendance/branch-picker'
import { CheckInConsole } from '@/components/attendance/check-in-console'
import { InGymNow } from '@/components/attendance/in-gym-now'
import { Card, CardContent } from '@/components/ui/card'
import { requireStaff } from '@/lib/auth'
import { attendanceDaySummary, inGymNow, listAttendance } from '@/lib/db/attendance'
import { memberPhotoUrls } from '@/lib/db/photos'
import { resolveBranchScope } from '@/lib/scope'

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

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
  const scope = await resolveBranchScope(params, staff)

  const canCheckIn =
    staff.role === 'owner' || staff.role === 'manager' || staff.role === 'front_desk'

  const branchIds = scope.branchIds

  // The branch to write attendance against (and to filter the log/label by).
  // Deliberately not `scope.selectedId`: a caller who covers exactly one
  // branch -- a single-branch desk or manager -- must always write to that
  // branch, even though the switcher never renders for them and `selectedId`
  // stays null. Null is reserved for the aggregate `CheckInConsole` actually
  // documents: a caller who covers *more than one* branch and has not picked
  // one, where the member's own home branch decides. Getting this wrong sent
  // a single-branch desk's checked-in members through the home-branch path,
  // which the server action then rejected as "You do not work at that branch"
  // whenever the member's home branch differed from the desk's own.
  const branchId = scope.options.length === 1 ? scope.options[0].id : scope.selectedId

  const [inGym, summary, log] = await Promise.all([
    inGymNow(branchIds),
    attendanceDaySummary({ branchIds }),
    listAttendance({ branchId: branchId ?? undefined, page: 1, pageSize: 25 }),
  ])

  // One signing round trip for the whole roster, not one per row.
  const photoUrls = await memberPhotoUrls(inGym.map((row) => row.photo_path))

  const checkIns = summary.reduce((total, row) => total + row.check_ins, 0)
  const distinctMembers = summary.reduce((total, row) => total + row.distinct_members, 0)
  // `scope.label` is already the branch's own name whenever `branchId` above
  // is concrete (an explicit pick, or the caller's only branch); only the
  // genuine multi-branch aggregate should read as "every branch."
  const branchName = branchId ? scope.label : null

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
            <CheckInConsole
              branchId={branchId ?? null}
              branchName={branchName}
              initialTerm={typeof params.q === 'string' ? params.q : undefined}
            />
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
