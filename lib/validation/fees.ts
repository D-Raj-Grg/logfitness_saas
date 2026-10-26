import { z } from 'zod'

import { rupeesSchema } from '@/lib/validation/plans'

/** How often a fee is charged. Mirrors the `fee_charge_rule` enum. */
export const FEE_CHARGE_RULES = ['once', 'every_sale'] as const
export type FeeChargeRule = (typeof FEE_CHARGE_RULES)[number]

export const FEE_CHARGE_RULE_LABELS: Record<FeeChargeRule, string> = {
  once: 'Once, on the first membership',
  every_sale: 'On every sale',
}

/** Same ceiling the letterhead's list fee uses: a fat-fingered extra zero stops here. */
const MAX_FEE_PAISA = 100_000_00

export const feeIdSchema = z.object({ feeId: z.uuid() })

export const feeSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
    chargeRule: z.enum(FEE_CHARGE_RULES),
    amountPaisa: rupeesSchema
      .refine((value) => value > 0, 'Amount must be more than zero')
      .refine((value) => value <= MAX_FEE_PAISA, 'That fee looks too large'),
    allPlans: z.boolean(),
    planIds: z.array(z.uuid()).default([]),
    isActive: z.boolean().default(true),
  })
  // Mirrors what validate_fee() cannot say in words: a fee that reaches no plan
  // charges nothing, which is never what the owner meant.
  .refine((value) => value.allPlans || value.planIds.length > 0, {
    message: 'Pick at least one plan, or apply the fee to all plans',
    path: ['planIds'],
  })

export const updateFeeSchema = feeIdSchema.extend({
  name: feeSchema.shape.name,
  chargeRule: feeSchema.shape.chargeRule,
  amountPaisa: feeSchema.shape.amountPaisa,
  allPlans: feeSchema.shape.allPlans,
  planIds: feeSchema.shape.planIds,
  isActive: feeSchema.shape.isActive,
})
