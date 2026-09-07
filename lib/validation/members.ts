import { z } from 'zod'

import { emailSchema } from '@/lib/validation/auth'
import { pageSizeSchema } from '@/lib/validation/pagination'
import { paymentMethodSchema } from '@/lib/validation/payments'
import { optionalRupeesSchema } from '@/lib/validation/plans'

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null))

export const phoneSchema = z
  .string()
  .trim()
  .min(5, 'Phone number is too short')
  .max(32, 'Phone number is too long')
  .regex(/^[+\d][\d\s-]*$/, 'Phone number may only contain digits, spaces, + and -')

export const memberSchema = z.object({
  fullName: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  phone: phoneSchema,
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((value) => (value ? value.toLowerCase() : null))
    .refine((value) => value === null || value.includes('@'), 'Enter a valid email'),
  homeBranchId: z.uuid('Pick a home branch'),
  dateOfBirth: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null))
    .refine(
      (value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value),
      'Enter the date as YYYY-MM-DD'
    ),
  gender: z.enum(['male', 'female', 'other']).optional().nullable(),
  address: optionalText(500),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: optionalText(32),
  notes: optionalText(2000),
})

export const updateMemberSchema = memberSchema.extend({
  memberId: z.uuid(),
})

export const memberLeaveSchema = z.object({
  memberId: z.uuid(),
  reason: optionalText(500),
})

export const memberIdSchema = z.object({ memberId: z.uuid() })

export const memberArchiveSchema = z.object({
  memberId: z.uuid(),
  reason: optionalText(500),
})

/**
 * Deleting is irreversible and takes the member's money with it, so the dialog
 * makes the person type the member's name and this checks it matched. A
 * confirmation the server never sees would be decoration.
 */
export const memberDeleteSchema = z.object({
  memberId: z.uuid(),
  confirmName: z.string().trim().min(1, 'Type the member\'s name to confirm'),
})

// Mirrors invite_member(p_member_id, p_email): the RPC re-validates everything,
// this just turns a malformed submission into a field error before the round
// trip.
export const inviteMemberToAppSchema = z.object({
  memberId: z.uuid(),
  email: emailSchema,
})

export const memberListQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
  status: z
    .enum(['active', 'expired', 'frozen', 'left', 'expiring', 'dues', 'archived'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: pageSizeSchema,
})

export type MemberInput = z.infer<typeof memberSchema>
export type MemberListQuery = z.infer<typeof memberListQuerySchema>

/**
 * The optional sale on the registration form. The fields ride along in the same
 * submission as the member's details but are only checked when `sell` is on, so
 * a plain registration cannot be blocked by a half-filled sale the desk thought
 * better of.
 *
 * Parsed separately from memberSchema rather than extending it: the cross-field
 * reference rule would turn the member schema into a ZodEffects and stop it
 * being extendable elsewhere. The field paths are deliberately unprefixed --
 * they are what the form reads back out of fieldErrors, not the FormData keys.
 */
export const memberSaleSchema = z
  .object({
    sell: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    planId: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value ? value : null)),
    discountPaisa: optionalRupeesSchema,
    amountPaidPaisa: optionalRupeesSchema,
    method: paymentMethodSchema.default('cash'),
    referenceNo: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((value) => (value ? value : null)),
    // Blank means today, which is what the RPC does with a null.
    startDate: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value ? value : null))
      .refine(
        (value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value),
        'Enter the date as YYYY-MM-DD'
      ),
  })
  .superRefine((value, ctx) => {
    if (!value.sell) return

    if (!value.planId || !z.uuid().safeParse(value.planId).success) {
      ctx.addIssue({ code: 'custom', message: 'Pick a plan', path: ['planId'] })
    }

    // Cash needs nothing; every digital rail needs the transaction reference.
    if (value.amountPaidPaisa > 0 && value.method !== 'cash' && !value.referenceNo) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter the transaction reference',
        path: ['referenceNo'],
      })
    }
  })

export type MemberSaleInput = z.infer<typeof memberSaleSchema>
