import { z } from 'zod'

import { toPaisa } from '@/lib/format'

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

const optionalRupees = z
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
    signupFeePaisa: optionalRupees,
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
