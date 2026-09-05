import { toPaisa } from '@/lib/format'
import type { PlanType } from '@/lib/members'

/**
 * Rupees typed so far, as paisa; garbage counts as nothing until it is fixed.
 * Used for the live totals a cashier watches while typing, never for what gets
 * saved -- the zod schema and the RPC are what decide that.
 */
export function paisaOrZero(rupeesTyped: string) {
  if (!rupeesTyped.trim()) return 0
  try {
    const value = toPaisa(rupeesTyped)
    return value < 0 ? 0 : value
  } catch {
    return 0
  }
}

export function rupees(paisa: number) {
  return String(paisa / 100)
}

/** "30 days" or "10 sessions" -- what the plan actually buys. */
export function planTerm(plan: {
  plan_type: PlanType
  duration_days: number | null
  session_count: number | null
}) {
  return plan.plan_type === 'session_pack'
    ? `${plan.session_count ?? 0} sessions`
    : `${plan.duration_days ?? 0} days`
}
