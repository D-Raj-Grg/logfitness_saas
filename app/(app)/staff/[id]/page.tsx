import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { EditStaffDialog } from '@/components/staff/edit-staff-dialog'
import { ResetPasswordDialog } from '@/components/staff/reset-password-dialog'
import {
  AttendancePanel,
  CheckinsPanel,
  PaymentsPanel,
  TrainerPanel,
  ACTIVITY_PAGE_SIZE,
  type TrainerTotals,
} from '@/components/staff/staff-activity-panels'
import {
  StaffActivityTabs,
  type StaffTabKey,
} from '@/components/staff/staff-activity-tabs'
import { StaffCardAccess } from '@/components/staff/staff-card-access'
import { STATUS_LABELS, StatusToggle, type StaffListRow } from '@/components/staff/staff-table'
import { StatTile } from '@/components/app/stat-tile'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requireRole } from '@/lib/auth'
import { listAttendance } from '@/lib/db/attendance'
import { listBranches } from '@/lib/db/branches'
import { listPtSessions } from '@/lib/db/pt'
import {
  dayStart,
  hasTrainerWork,
  listClassesTaughtBy,
  listPaymentsCollectedBy,
} from '@/lib/db/staff-activity'
import { getStaff } from '@/lib/db/staff'
import { getStaffAttendanceSummary, listStaffAttendance } from '@/lib/db/staff-attendance'
import { listStaffCards, listUnassignedCardScansForStaff } from '@/lib/db/staff-cards'
import { trainerUtilization } from '@/lib/db/trainer-utilization'
import {
  addDays,
  formatDate,
  formatDateTime,
  formatTime,
  isRealIsoDate,
  todayInTimezone,
} from '@/lib/format'
import { lastVisitLabel } from '@/lib/last-visit'
import { ROLE_LABELS, assignableRoles } from '@/lib/roles'

type SearchParams = Record<string, string | string[] | undefined>


function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">
        {value ?? <span className="text-muted-foreground">--</span>}
      </dd>
    </div>
  )
}

export default async function StaffProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<SearchParams>
}) {
  // RLS lets every staff role read every staff row, so this is the only thing
  // standing between a trainer and a colleague's contact details.
  const actor = await requireRole('owner', 'manager')
  const { id } = await params
  const query = await searchParams

  const [target, branches] = await Promise.all([getStaff(id), listBranches()])
  if (!target) notFound()

  // A manager sees colleagues at their own branches. A foreign id is a 404,
  // not a refusal: the page should not confirm that someone exists elsewhere.
  if (
    actor.role !== 'owner' &&
    // Owners have no branches of their own and work everywhere, so the staff
    // list already shows them to a manager; only branch staff are filtered.
    target.role !== 'owner' &&
    !target.branch_ids.some((branchId) => actor.branchIds.includes(branchId))
  ) {
    notFound()
  }
  const isSelf = target.id === actor.staffId
  const canEdit = !isSelf && assignableRoles(actor.role).includes(target.role)
  // Owners and managers are scoped by branch the same way every report is.
  const scope = actor.role === 'owner' ? null : actor.branchIds
  const branchNames = Object.fromEntries(branches.map((branch) => [branch.id, branch.name]))

  const row: StaffListRow = {
    id: target.id,
    full_name: target.full_name,
    email: target.email,
    phone: target.phone,
    role: target.role,
    branch_ids: target.branch_ids,
    status: target.status,
    accepted_at: target.accepted_at,
  }

  // --- Which tabs, which one is open, and the date window they share -----
  const showTrainer = target.role === 'trainer' || (await hasTrainerWork(target.id))
  const tabs: StaffTabKey[] = [
    'attendance',
    'checkins',
    'payments',
    ...(showTrainer ? (['trainer'] as const) : []),
  ]
  const rawTab = first(query.tab)
  const active: StaffTabKey = tabs.includes(rawTab as StaffTabKey)
    ? (rawTab as StaffTabKey)
    : 'attendance'

  const today = todayInTimezone()
  const rawOn = first(query.on)
  const rawTo = first(query.to)
  let on = isRealIsoDate(rawOn) ? rawOn : addDays(today, -29)
  let to = isRealIsoDate(rawTo) ? rawTo : today
  // A backwards range is a typo, not a question.
  if (on > to) [on, to] = [to, on]
  const rawPage = Number(first(query.page))
  const page = Number.isInteger(rawPage) && rawPage > 1 ? rawPage : 1

  function hrefFor(target: number) {
    const next = new URLSearchParams()
    next.set('tab', active)
    next.set('on', on)
    next.set('to', to)
    if (target > 1) next.set('page', String(target))
    return `/staff/${id}?${next.toString()}`
  }

  const showBranchColumn = scope === null || scope.length > 1

  // A manager may card front desk and trainers at their own branches; an owner
  // may card anyone, themselves included. Same rule assign_staff_card enforces,
  // so nobody is offered a button the database would refuse.
  const canManageCard =
    actor.role === 'owner' ||
    (!isSelf &&
      target.role !== 'owner' &&
      target.role !== 'manager' &&
      target.branch_ids.some((branchId) => actor.branchIds.includes(branchId)))

  // The tile, the card panel and (when open) the Attendance tab all read from
  // these, so they are fetched once, together.
  const [summary, cards, scans] = await Promise.all([
    getStaffAttendanceSummary(target.id, { from: on, to }).catch(() => null),
    listStaffCards(target.id).catch(() => null),
    canManageCard ? listUnassignedCardScansForStaff(scope).catch(() => []) : Promise.resolve([]),
  ])

  let panel: React.ReactNode = null

  if (active === 'attendance') {
    const shifts = await listStaffAttendance(target.id, {
      on,
      to,
      branchIds: scope,
      page,
      pageSize: ACTIVITY_PAGE_SIZE,
    })
    panel = (
      <AttendancePanel
        name={target.full_name}
        rows={shifts.rows}
        total={shifts.total}
        summary={summary}
        page={shifts.page}
        on={on}
        to={to}
        today={today}
        showBranch={showBranchColumn}
        hrefFor={hrefFor}
      />
    )
  } else if (active === 'checkins') {
    const log = await listAttendance({
      checkedInBy: target.id,
      branchIds: scope ?? undefined,
      on,
      to,
      page,
      pageSize: ACTIVITY_PAGE_SIZE,
    })
    panel = (
      <CheckinsPanel
        name={target.full_name}
        rows={log.rows}
        total={log.total}
        page={log.page}
        on={on}
        to={to}
        today={today}
        showBranch={showBranchColumn}
        hrefFor={hrefFor}
      />
    )
  } else if (active === 'payments') {
    const result = await listPaymentsCollectedBy({
      staffId: target.id,
      branchIds: scope,
      from: on,
      to,
      page,
      pageSize: ACTIVITY_PAGE_SIZE,
    })
    panel = (
      <PaymentsPanel
        name={target.full_name}
        rows={result.rows}
        total={result.total}
        sums={result.sums}
        totalsPartial={result.totalsPartial}
        page={result.page}
        on={on}
        to={to}
        today={today}
        showBranch={showBranchColumn}
        hrefFor={hrefFor}
      />
    )
  } else {
    const [utilization, classes, sessions] = await Promise.all([
      trainerUtilization({ branchIds: scope, from: on, to }),
      listClassesTaughtBy({ staffId: target.id, branchIds: scope, from: on, to }),
      listPtSessions({ branchIds: scope, trainerId: target.id, since: dayStart(on) }),
    ])

    const totals: TrainerTotals = utilization
      .filter((entry) => entry.trainer_id === target.id)
      .reduce<TrainerTotals>(
        (sum, entry) => ({
          classes_held: sum.classes_held + entry.classes_held,
          class_hours: sum.class_hours + entry.class_hours,
          seats_available: sum.seats_available + entry.seats_available,
          seats_filled: sum.seats_filled + entry.seats_filled,
          attended: sum.attended + entry.attended,
          no_shows: sum.no_shows + entry.no_shows,
          pt_completed: sum.pt_completed + entry.pt_completed,
          pt_hours: sum.pt_hours + entry.pt_hours,
        }),
        {
          classes_held: 0,
          class_hours: 0,
          seats_available: 0,
          seats_filled: 0,
          attended: 0,
          no_shows: 0,
          pt_completed: 0,
          pt_hours: 0,
        }
      )

    // listPtSessions has a floor but no ceiling, and runs soonest first.
    const ceiling = dayStart(addDays(to, 1))
    const inRange = sessions
      .filter((session) => session.scheduled_at < ceiling)
      .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at))

    panel = (
      <TrainerPanel
        name={target.full_name}
        totals={totals}
        classes={classes}
        sessions={inRange}
        on={on}
        to={to}
        today={today}
      />
    )
  }

  const branchLabel =
    target.role === 'owner'
      ? 'All branches'
      : target.branch_ids.map((branchId) => branchNames[branchId] ?? 'Unknown').join(', ') || '--'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar size="lg" className="size-12 sm:size-14">
            <AvatarFallback className="text-base">{initials(target.full_name)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-1">
            <Link
              href="/staff"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline print:hidden"
            >
              ← All staff
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold sm:text-2xl">{target.full_name}</h1>
              <Badge variant={target.status === 'active' ? 'default' : 'secondary'}>
                {STATUS_LABELS[target.status]}
              </Badge>
            </div>
            <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
              <span>{ROLE_LABELS[target.role]}</span>
              <span>{target.email}</span>
              {target.phone ? <span>{target.phone}</span> : null}
              <span>{branchLabel}</span>
            </p>
          </div>
        </div>

        {isSelf ? (
          <span className="text-sm text-muted-foreground">This is you</span>
        ) : (
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {canEdit ? (
              <>
                <EditStaffDialog
                  row={row}
                  actorRole={actor.role}
                  actorBranchIds={actor.branchIds}
                  branches={branches}
                />
                <ResetPasswordDialog row={row} />
              </>
            ) : null}
            <StatusToggle row={row} />
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Role" value={ROLE_LABELS[target.role]} />
            <Detail label="Email" value={target.email} />
            <Detail label="Phone" value={target.phone} />
            <Detail label="Branches" value={branchLabel} />
            <Detail label="Added on" value={formatDate(target.created_at)} />
            <Detail
              label={target.accepted_at ? 'Signed up on' : 'Invited on'}
              value={formatDate(target.accepted_at ?? target.invited_at)}
            />
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <StatTile
          label="Last clock-in"
          value={
            summary?.on_shift
              ? 'On shift now'
              : summary?.last_clock_in_at
                ? formatDateTime(summary.last_clock_in_at)
                : 'Never'
          }
          hint={
            summary?.on_shift && summary.last_clock_in_at
              ? `Clocked in at ${formatTime(summary.last_clock_in_at)}`
              : summary?.last_attended_on
                ? `${lastVisitLabel(summary.last_attended_on, today).label} · see all shifts`
                : 'No card taps yet'
          }
          href={`/staff/${id}?tab=attendance`}
        />
        <div className="lg:col-span-2">
          <StaffCardAccess
            staffId={target.id}
            cards={cards}
            scans={scans}
            canManage={canManageCard}
            status={target.status}
          />
        </div>
      </div>

      <Suspense>
        <StaffActivityTabs active={active} tabs={tabs}>
          {panel}
        </StaffActivityTabs>
      </Suspense>
    </div>
  )
}
