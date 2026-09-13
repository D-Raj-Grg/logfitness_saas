import {
  AttendanceMiniChart,
  MovementChart,
  RevenueTrendChart,
} from '@/components/dashboard/charts-lazy'
import { ChartCard, ChartEmpty } from '@/components/dashboard/chart-card'
import {
  attendanceTrend,
  membershipMovement,
  revenueReport,
} from '@/lib/db/reports'
import { addDays, formatMoney, todayInTimezone } from '@/lib/format'

/** How far back each panel looks. Short enough to read at a glance. */
const REVENUE_DAYS = 30
const ATTENDANCE_DAYS = 14
const MOVEMENT_MONTHS = 6

/**
 * Every day in the window, whether or not the report returned a row for it.
 * A closed day is a real zero and has to be drawn as one -- dropping it would
 * pull the line across the gap and quietly flatter a bad week.
 */
function fillDays<T extends { period: string }>(
  from: string,
  to: string,
  rows: Map<string, T>,
  empty: (period: string) => T
): T[] {
  const out: T[] = []
  for (let day = from; day <= to; day = addDays(day, 1)) {
    out.push(rows.get(day) ?? empty(day))
  }
  return out
}

export async function RevenuePanel({ branchIds }: { branchIds: string[] | null }) {
  const to = todayInTimezone()
  const from = addDays(to, -(REVENUE_DAYS - 1))
  const rows = await revenueReport({ branchIds, from, to, groupBy: 'day' })

  // One row per branch and method; the panel reads a single net line for the
  // whole scope, so periods are summed here.
  const byPeriod = new Map<string, { period: string; net_paisa: number }>()
  for (const row of rows) {
    const period = row.period.slice(0, 10)
    const existing = byPeriod.get(period)
    if (existing) existing.net_paisa += row.net_paisa
    else byPeriod.set(period, { period, net_paisa: row.net_paisa })
  }

  const points = fillDays(from, to, byPeriod, (period) => ({ period, net_paisa: 0 }))
  const total = points.reduce((sum, point) => sum + point.net_paisa, 0)

  return (
    <ChartCard
      title="Revenue"
      description={`${formatMoney(total)} net over ${REVENUE_DAYS} days`}
      href="/reports/revenue"
      linkLabel="Report"
    >
      {total === 0 && rows.length === 0 ? (
        <ChartEmpty>Nothing has been collected in the last {REVENUE_DAYS} days.</ChartEmpty>
      ) : (
        <RevenueTrendChart points={points} />
      )}
    </ChartCard>
  )
}

export async function AttendancePanel({ branchIds }: { branchIds: string[] | null }) {
  const to = todayInTimezone()
  const from = addDays(to, -(ATTENDANCE_DAYS - 1))
  const rows = await attendanceTrend({ branchIds, from, to, groupBy: 'day' })

  const byPeriod = new Map<
    string,
    { period: string; check_ins: number; distinct_members: number }
  >()
  for (const row of rows) {
    const period = row.period.slice(0, 10)
    const existing = byPeriod.get(period)
    if (existing) {
      existing.check_ins += row.check_ins
      // Summing distinct members across branches double-counts anyone who
      // trained at two of them. That is rare enough to accept here and the
      // alternative -- a second query per branch -- is not worth it on a
      // dashboard panel.
      existing.distinct_members += row.distinct_members
    } else {
      byPeriod.set(period, {
        period,
        check_ins: row.check_ins,
        distinct_members: row.distinct_members,
      })
    }
  }

  const points = fillDays(from, to, byPeriod, (period) => ({
    period,
    check_ins: 0,
    distinct_members: 0,
  }))
  const visits = points.reduce((sum, point) => sum + point.check_ins, 0)

  return (
    <ChartCard
      title="Who is coming in"
      description={`${visits} visits over ${ATTENDANCE_DAYS} days`}
      href="/reports/attendance"
      linkLabel="Report"
    >
      {visits === 0 ? (
        <ChartEmpty>No check-ins recorded in the last {ATTENDANCE_DAYS} days.</ChartEmpty>
      ) : (
        <AttendanceMiniChart points={points} />
      )}
    </ChartCard>
  )
}

export async function MovementPanel({ branchIds }: { branchIds: string[] | null }) {
  const to = todayInTimezone()
  const [year, month] = to.split('-').map(Number)
  const from = new Date(Date.UTC(year, month - 1 - (MOVEMENT_MONTHS - 1), 1))
    .toISOString()
    .slice(0, 10)

  const rows = await membershipMovement({ branchIds, from, to, groupBy: 'month' })

  const byPeriod = new Map<
    string,
    { period: string; new_members: number; renewals: number; expiries: number }
  >()
  for (const row of rows) {
    const period = row.period.slice(0, 10)
    const existing = byPeriod.get(period)
    if (existing) {
      existing.new_members += row.new_members
      existing.renewals += row.renewals
      existing.expiries += row.expiries
    } else {
      byPeriod.set(period, {
        period,
        new_members: row.new_members,
        renewals: row.renewals,
        expiries: row.expiries,
      })
    }
  }

  const points = Array.from(byPeriod.values()).sort((a, b) =>
    a.period.localeCompare(b.period)
  )
  const gained = points.reduce((sum, point) => sum + point.new_members + point.renewals, 0)
  const lost = points.reduce((sum, point) => sum + point.expiries, 0)
  const net = gained - lost

  return (
    <ChartCard
      title="Membership movement"
      description={`${net >= 0 ? '+' : ''}${net} over ${MOVEMENT_MONTHS} months · ${gained} in, ${lost} out`}
      href="/reports/movement"
      linkLabel="Report"
    >
      {points.length === 0 ? (
        <ChartEmpty>No memberships have started or ended in this window.</ChartEmpty>
      ) : (
        <MovementChart points={points} />
      )}
    </ChartCard>
  )
}
