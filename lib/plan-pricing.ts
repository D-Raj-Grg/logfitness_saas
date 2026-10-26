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

/**
 * The joining fee split for one sale: what is charged, and what is waived.
 *
 * Mirrors `renew_membership` exactly -- the counter must not promise a number
 * the RPC then writes differently. The fee is charged once, on a member's
 * first membership. The reference is the plan's own fee, or the gym's list fee
 * when the plan carries none, which is what lets a long-term tier sold as
 * "joining fee waived" show the amount it waived.
 *
 * The waiver is a memo. It is outside the subtotal and outside the total.
 */
export function signupFeeSplit({
  planSignupFeePaisa,
  orgStandardFeePaisa,
  isFirstMembership,
}: {
  planSignupFeePaisa: number
  orgStandardFeePaisa: number
  isFirstMembership: boolean
}) {
  const charged = isFirstMembership ? planSignupFeePaisa : 0
  const reference = planSignupFeePaisa > 0 ? planSignupFeePaisa : orgStandardFeePaisa

  return { charged, waived: Math.max(reference - charged, 0) }
}

/** How often a fee is charged. Mirrors the `fee_charge_rule` enum. */
export type FeeRule = 'once' | 'every_sale'

/** A fee as the counter needs it: what it costs and which plans carry it. */
export type CatalogueFee = {
  id: string
  name: string
  charge_rule: FeeRule
  amount_paisa: number
  all_plans: boolean
  plan_ids: string[]
  sort_order: number
}

/** One fee line of one sale: what it charges, and what it takes back off. */
export type SaleFee = {
  feeId: string | null
  name: string
  chargeRule: FeeRule
  chargedPaisa: number
  waivedPaisa: number
}

/**
 * The fees one plan carries on one sale, from the catalogue.
 *
 * Mirrors `sale_fees()` (20261027100000_fee_catalogue.sql) exactly -- the
 * counter must not promise a number the RPC then writes differently. A fee
 * reaches a plan when it is on for all plans or lists the plan. A `once` fee is
 * charged on the member's first membership and shown taken back off on every
 * later one; an `every_sale` fee is charged every time and has nothing to take
 * off. Order is sort_order, then name, as in the database.
 *
 * `fees` is whatever `loadPlansForBranch` returned: active fees only, so an
 * inactive fee is neither charged nor shown, as in the database.
 */
export function saleFees({
  fees,
  planId,
  isFirstMembership,
}: {
  fees: CatalogueFee[]
  planId: string
  isFirstMembership: boolean
}): SaleFee[] {
  return fees
    .filter((fee) => fee.all_plans || fee.plan_ids.includes(planId))
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    )
    .map((fee) => {
      const charged = fee.charge_rule === 'every_sale' || isFirstMembership
      return {
        feeId: fee.id,
        name: fee.name,
        chargeRule: fee.charge_rule,
        chargedPaisa: charged ? fee.amount_paisa : 0,
        waivedPaisa: fee.charge_rule === 'once' && !isFirstMembership ? fee.amount_paisa : 0,
      }
    })
}

/**
 * The fee lines and the fee total for one sale of one plan, whichever way the
 * org charges. While `fee_catalogue_enabled` is false the one fee is the
 * plan's legacy joining fee (`signupFeeSplit`), presented as a single
 * "Registration fee" row so both sale forms render the same shape.
 */
export function feeQuote({
  plan,
  fees,
  catalogueEnabled,
  standardSignupFeePaisa,
  isFirstMembership,
}: {
  plan: { id: string; signup_fee_paisa: number } | null
  fees: CatalogueFee[]
  catalogueEnabled: boolean
  standardSignupFeePaisa: number
  isFirstMembership: boolean
}): { rows: SaleFee[]; chargedPaisa: number } {
  if (!plan) return { rows: [], chargedPaisa: 0 }

  let rows: SaleFee[]
  if (catalogueEnabled) {
    rows = saleFees({ fees, planId: plan.id, isFirstMembership })
  } else {
    const split = signupFeeSplit({
      planSignupFeePaisa: plan.signup_fee_paisa,
      orgStandardFeePaisa: standardSignupFeePaisa,
      isFirstMembership,
    })
    rows =
      split.charged > 0 || split.waived > 0
        ? [
            {
              feeId: null,
              name: 'Registration fee',
              chargeRule: 'once',
              chargedPaisa: split.charged,
              waivedPaisa: split.waived,
            },
          ]
        : []
  }

  return { rows, chargedPaisa: rows.reduce((sum, row) => sum + row.chargedPaisa, 0) }
}
