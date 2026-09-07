import { createClient } from '@/lib/supabase/server'

/** One row per branch in scope, plus a totals row where branch_id is null. */
export async function orgSnapshot(branchIds?: string[] | null) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('org_snapshot', {
    p_branch_ids: branchIds ?? undefined,
  })

  if (error) throw error
  return data ?? []
}

export type ReportPeriod = 'day' | 'week' | 'month'

/**
 * Gross, refunds, reversals and net, by period, branch and method.
 *
 * refunds_paisa and reversals_paisa are kept apart: a refund means cash left
 * the drawer, a reversal means a note that was rung up never arrived. Both
 * reduce net_paisa, but a branch with a problem has a different problem in
 * each case.
 */
export async function revenueReport(args: {
  branchIds?: string[] | null
  from?: string
  to?: string
  groupBy?: ReportPeriod
}) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('revenue_report', {
    p_branch_ids: args.branchIds ?? undefined,
    p_from: args.from ?? undefined,
    p_to: args.to ?? undefined,
    p_group_by: args.groupBy ?? 'day',
  })

  if (error) throw error
  return data ?? []
}

/**
 * New, renewed, expired and churned members, by period and branch. Reads the
 * append-only membership history, which is what makes a first sale and a
 * renewal tellable apart.
 */
export async function membershipMovement(args: {
  branchIds?: string[] | null
  from?: string
  to?: string
  groupBy?: ReportPeriod
}) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('membership_movement', {
    p_branch_ids: args.branchIds ?? undefined,
    p_from: args.from ?? undefined,
    p_to: args.to ?? undefined,
    p_group_by: args.groupBy ?? 'month',
  })

  if (error) throw error
  return data ?? []
}

/**
 * Check-ins by period and branch. distinct_members is the honest number: one
 * member who trains six times is six check_ins but one person still using
 * the gym, and distinct_members is what tells you whether the branch is
 * growing.
 */
export async function attendanceTrend(args: {
  branchIds?: string[] | null
  from?: string
  to?: string
  groupBy?: ReportPeriod
}) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('attendance_trend', {
    p_branch_ids: args.branchIds ?? undefined,
    p_from: args.from ?? undefined,
    p_to: args.to ?? undefined,
    p_group_by: args.groupBy ?? 'day',
  })

  if (error) throw error
  return data ?? []
}

/**
 * Active memberships and billed revenue by plan and branch. share_pct is
 * each row's share of ALL active memberships in scope (every branch
 * branchIds allows, summed together), not a share confined to that row's
 * own branch -- pass a single branch id to get that branch's own mix.
 */
export async function planMix(branchIds?: string[] | null) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('plan_mix', {
    p_branch_ids: branchIds ?? undefined,
  })

  if (error) throw error
  return data ?? []
}
