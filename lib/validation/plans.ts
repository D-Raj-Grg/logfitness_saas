import { z } from 'zod'

import { toPaisa } from '@/lib/format'
import { DISCOUNT_REASONS, type DiscountReason } from '@/lib/members'

/** Rupees typed by a human, stored as integer paisa. */
export const rupeesSchema = z
  .string()
  .trim()
  .min(1, 'Enter an amount')
  .transform((value, ctx) => {
    try {
      const paisa = toPaisa(value)
      if (paisa < 0) {
        ctx.addIssue({ code: 'custom', message: 'Amount cannot be negative' })
        return z.NEVER
      }
      return paisa
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid amount' })
      return z.NEVER
    }
  })

/** Rupees, or blank meaning nothing was charged. */
export const optionalRupeesSchema = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx) => {
    if (!value) return 0
    try {
      const paisa = toPaisa(value)
      if (paisa < 0) {
        ctx.addIssue({ code: 'custom', message: 'Amount cannot be negative' })
        return z.NEVER
      }
      return paisa
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid amount' })
      return z.NEVER
    }
  })

/**
 * The discount reason, as it comes off a form: '' when the select was never
 * touched. The cross-field rules -- a reason is required when money comes off,
 * a note is required for 'other' -- live on the schemas that own both fields,
 * because only they can see the amount. renew_membership enforces the same
 * pair again in the database, which is where it actually binds.
 */
export const discountReasonSchema = z
  .enum(DISCOUNT_REASONS)
  .optional()
  .or(z.literal(''))
  .transform((value) => (value ? (value as DiscountReason) : null))

export const discountNoteSchema = z
  .string()
  .trim()
  .max(120, 'Keep the note under 120 characters')
  .optional()
  .transform((value) => (value ? value : null))

/**
 * Applies the pair rule to any schema carrying discountPaisa, discountReason
 * and discountNote. Shared so registration and renewal cannot drift.
 */
export function refineDiscount<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const sale = value as {
      discountPaisa?: number | null
      discountReason?: DiscountReason | null
      discountNote?: string | null
    }
    const amount = sale.discountPaisa ?? 0

    if (amount > 0 && !sale.discountReason) {
      ctx.addIssue({
        code: 'custom',
        path: ['discountReason'],
        message: 'Choose a reason for the discount',
      })
    }

    if (amount === 0 && sale.discountReason) {
      ctx.addIssue({
        code: 'custom',
        path: ['discountReason'],
        message: 'There is no discount to give a reason for',
      })
    }

    if (sale.discountReason === 'other' && !sale.discountNote) {
      ctx.addIssue({
        code: 'custom',
        path: ['discountNote'],
        message: 'Describe the discount reason',
      })
    }
  })
}

export const planSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
    description: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => (value ? value : null)),
    planType: z.enum(['time', 'session_pack']),
    durationDays: z.coerce.number().int().positive().optional().nullable(),
    sessionCount: z.coerce.number().int().positive().optional().nullable(),
    pricePaisa: rupeesSchema,
    signupFeePaisa: optionalRupeesSchema,
    branchIds: z.array(z.uuid()).default([]),
    isActive: z.boolean().default(true),
  })
  // Mirrors the membership_plans_shape check constraint so the error lands on
  // the right field instead of as a database exception.
  .refine(
    (value) => value.planType !== 'time' || (value.durationDays ?? 0) > 0,
    { message: 'A time plan needs a duration in days', path: ['durationDays'] }
  )
  .refine(
    (value) => value.planType !== 'session_pack' || (value.sessionCount ?? 0) > 0,
    { message: 'A session pack needs a session count', path: ['sessionCount'] }
  )
  .transform((value) => ({
    ...value,
    durationDays: value.planType === 'time' || value.durationDays ? value.durationDays ?? null : null,
    sessionCount: value.planType === 'session_pack' ? value.sessionCount ?? null : null,
  }))

export const updatePlanSchema = z.object({
  planId: z.uuid(),
}).and(planSchema)

export const planIdSchema = z.object({ planId: z.uuid() })

export type PlanInput = z.infer<typeof planSchema>
