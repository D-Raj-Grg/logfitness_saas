import { NextRequest } from 'next/server'

import { requireRole } from '@/lib/auth'
import { toCsv } from '@/lib/csv'
import { absentMembers } from '@/lib/db/attendance'
import { arrearsReport, dailyCollection } from '@/lib/db/payments'
import {
  attendanceTrend,
  membershipMovement,
  planMix,
  revenueReport,
} from '@/lib/db/reports'
import { formatMoney, todayInTimezone } from '@/lib/format'
import { resolvePeriod, type ResolvedPeriod } from '@/lib/reports/period'
import { resolveBranchScope, type BranchScope } from '@/lib/scope'

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

type ReportDefinition = {
  fetch: (ctx: {
    scope: BranchScope
    period: ResolvedPeriod
    searchParams: SearchParams
  }) => Promise<Record<string, unknown>[]>
  columns: { key: string; header: string }[]
}

/**
 * Each fetch mirrors its screen's own query exactly -- same wrappers, same
 * filters -- so the export is the whole report the caller is looking at,
 * never a slice of it. None of these wrappers paginate (no limit/offset
 * anywhere in this map); the three reports whose screens carry an on-page
 * filter (arrears' bucket, absent's band) fetch the unfiltered set from the
 * database first and then apply the same filter the page applies, exactly as
 * the page itself does, so the file matches what is on screen.
 */
const REPORTS: Record<string, ReportDefinition> = {
  revenue: {
    fetch: async ({ scope, period }) => {
      const rows = await revenueReport({
        branchIds: scope.branchIds,
        from: period.from,
        to: period.to,
        groupBy: period.groupBy,
      })
      return rows.map((row) => ({
        period: row.period,
        branch_name: row.branch_name,
        method: row.method,
        gross: formatMoney(row.gross_paisa),
        refunds: formatMoney(row.refunds_paisa),
        reversals: formatMoney(row.reversals_paisa),
        net: formatMoney(row.net_paisa),
        txn_count: row.txn_count,
      }))
    },
    columns: [
      { key: 'period', header: 'Period' },
      { key: 'branch_name', header: 'Branch' },
      { key: 'method', header: 'Method' },
      { key: 'gross', header: 'Gross' },
      { key: 'refunds', header: 'Refunds' },
      { key: 'reversals', header: 'Reversals' },
      { key: 'net', header: 'Net' },
      { key: 'txn_count', header: 'Transactions' },
    ],
  },

  movement: {
    fetch: async ({ scope, period }) => {
      const rows = await membershipMovement({
        branchIds: scope.branchIds,
        from: period.from,
        to: period.to,
        groupBy: period.groupBy,
      })
      return rows.map((row) => ({
        period: row.period,
        branch_name: row.branch_name,
        new_members: row.new_members,
        renewals: row.renewals,
        expiries: row.expiries,
        churned: row.churned,
      }))
    },
    columns: [
      { key: 'period', header: 'Period' },
      { key: 'branch_name', header: 'Branch' },
      { key: 'new_members', header: 'New' },
      { key: 'renewals', header: 'Renewals' },
      { key: 'expiries', header: 'Expiries' },
      { key: 'churned', header: 'Churned' },
    ],
  },

  attendance: {
    fetch: async ({ scope, period }) => {
      const rows = await attendanceTrend({
        branchIds: scope.branchIds,
        from: period.from,
        to: period.to,
        groupBy: period.groupBy,
      })
      return rows.map((row) => ({
        period: row.period,
        branch_name: row.branch_name,
        check_ins: row.check_ins,
        distinct_members: row.distinct_members,
      }))
    },
    columns: [
      { key: 'period', header: 'Period' },
      { key: 'branch_name', header: 'Branch' },
      { key: 'check_ins', header: 'Check-ins' },
      { key: 'distinct_members', header: 'Distinct members' },
    ],
  },

  plans: {
    // plan_mix's own share_pct is each row's share of every active
    // membership IN SCOPE, not of its own branch. The screen recomputes each
    // plan's share of its own branch's active memberships; the export mirrors
    // that so the "Share" column matches what is on screen.
    fetch: async ({ scope }) => {
      const rows = await planMix(scope.branchIds)

      const totalsByBranch = new Map<string, number>()
      for (const row of rows) {
        totalsByBranch.set(
          row.branch_id,
          (totalsByBranch.get(row.branch_id) ?? 0) + row.active_memberships
        )
      }

      return rows.map((row) => {
        const total = totalsByBranch.get(row.branch_id) ?? 0
        return {
          branch_name: row.branch_name,
          plan_name: row.plan_name,
          plan_kind: row.plan_kind,
          active_memberships: row.active_memberships,
          revenue: formatMoney(row.revenue_paisa),
          share: total === 0 ? '' : `${((row.active_memberships / total) * 100).toFixed(1)}%`,
        }
      })
    },
    columns: [
      { key: 'branch_name', header: 'Branch' },
      { key: 'plan_name', header: 'Plan' },
      { key: 'plan_kind', header: 'Kind' },
      { key: 'active_memberships', header: 'Active memberships' },
      { key: 'revenue', header: 'Revenue' },
      { key: 'share', header: 'Share' },
    ],
  },

  collection: {
    fetch: async ({ scope, searchParams }) => {
      const on = first(searchParams.on) || todayInTimezone()
      const rows = await dailyCollection({ on, branchIds: scope.branchIds })
      return rows.map((row) => ({
        branch_name: row.branch_name,
        staff_name: row.staff_name,
        method: row.method,
        kind: row.kind,
        amount: formatMoney(row.amount_paisa),
        txn_count: row.txn_count,
      }))
    },
    columns: [
      { key: 'branch_name', header: 'Branch' },
      { key: 'staff_name', header: 'Collected by' },
      { key: 'method', header: 'Method' },
      { key: 'kind', header: 'Kind' },
      { key: 'amount', header: 'Amount' },
      { key: 'txn_count', header: 'Transactions' },
    ],
  },

  arrears: {
    fetch: async ({ scope, searchParams }) => {
      const bucket = first(searchParams.bucket)
      const allRows = await arrearsReport(scope.branchIds)
      const rows = bucket ? allRows.filter((row) => row.bucket === bucket) : allRows
      return rows.map((row) => ({
        member_code: row.member_code,
        full_name: row.full_name,
        phone: row.phone,
        home_branch_name: row.home_branch_name,
        due: formatMoney(row.due_paisa),
        oldest_due_on: row.oldest_due_on,
        age_days: row.age_days,
        bucket: row.bucket,
      }))
    },
    columns: [
      { key: 'member_code', header: 'Member code' },
      { key: 'full_name', header: 'Name' },
      { key: 'phone', header: 'Phone' },
      { key: 'home_branch_name', header: 'Branch' },
      { key: 'due', header: 'Due' },
      { key: 'oldest_due_on', header: 'Oldest due on' },
      { key: 'age_days', header: 'Age (days)' },
      { key: 'bucket', header: 'Bucket' },
    ],
  },

  absent: {
    fetch: async ({ scope, searchParams }) => {
      const minDays = Number(first(searchParams.minDays)) || 14
      const band = first(searchParams.band)
      const allRows = await absentMembers({ branchIds: scope.branchIds, minDays })
      const rows = band ? allRows.filter((row) => row.band === band) : allRows
      return rows.map((row) => ({
        member_code: row.member_code,
        full_name: row.full_name,
        phone: row.phone,
        home_branch_name: row.home_branch_name,
        last_seen_on: row.last_seen_on,
        ever_visited: row.ever_visited,
        days_absent: row.days_absent,
        band: row.band,
        due: formatMoney(row.due_paisa),
        membership_end_date: row.membership_end_date,
        days_to_expiry: row.days_to_expiry,
      }))
    },
    columns: [
      { key: 'member_code', header: 'Member code' },
      { key: 'full_name', header: 'Name' },
      { key: 'phone', header: 'Phone' },
      { key: 'home_branch_name', header: 'Branch' },
      { key: 'last_seen_on', header: 'Last seen on' },
      { key: 'ever_visited', header: 'Ever visited' },
      { key: 'days_absent', header: 'Days absent' },
      { key: 'band', header: 'Band' },
      { key: 'due', header: 'Due' },
      { key: 'membership_end_date', header: 'Membership end date' },
      { key: 'days_to_expiry', header: 'Days to expiry' },
    ],
  },
}

/**
 * The export runs the report again, server-side, AS THE CALLER -- the same
 * cookie-bound Supabase client the page used, so RLS applies to the file
 * exactly as it applied to the screen. It therefore contains the whole report
 * rather than the page currently displayed, which is the point of an export.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ report: string }> }
) {
  const { report } = await params

  // requireRole redirects (throws NEXT_REDIRECT) rather than returning a
  // status. Confirmed against node_modules/next/dist/docs/01-app -- redirect()
  // is explicitly supported in Route Handlers and, outside a streaming
  // context, issues a real 307 HTTP redirect response. The download link is a
  // plain <a>, so the browser follows that redirect to the login page exactly
  // as it would for a navigation; there is no case here where the browser is
  // left holding a broken download.
  //
  // Checked before the report lookup so a signed-out request (or the wrong
  // role) is always sent to log in, never told whether the report name it
  // guessed exists.
  const staff = await requireRole('owner', 'manager')

  const definition = REPORTS[report]
  if (!definition) {
    return new Response('Unknown report', { status: 404 })
  }

  const searchParams = Object.fromEntries(request.nextUrl.searchParams.entries())
  const scope = await resolveBranchScope(searchParams, staff)
  const period = resolvePeriod(searchParams)

  const rows = await definition.fetch({ scope, period, searchParams })
  const body = toCsv(rows, definition.columns)

  const branchPart = scope.selectedId ? 'branch' : 'all'
  const filename = `${report}-${branchPart}-${period.from}-to-${period.to}.csv`

  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  })
}
