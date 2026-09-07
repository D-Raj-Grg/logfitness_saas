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
