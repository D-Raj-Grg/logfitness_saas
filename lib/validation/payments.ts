import { z } from 'zod'

import {
  discountNoteSchema,
  discountReasonSchema,
  refineDiscount,
  rupeesSchema,
} from '@/lib/validation/plans'

export const paymentMethodSchema = z.enum([
  'cash',
  'esewa',
  'khalti',
  'fonepay',
  'bank',
  'card',
])

const referenceSchema = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((value) => (value ? value : null))

const notesSchema = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((value) => (value ? value : null))

/** Cash needs nothing; every digital rail needs the transaction reference. */
const requireReferenceForDigital = <T extends { method: string; referenceNo: string | null }>(
  value: T
) => value.method === 'cash' || Boolean(value.referenceNo)

export const renewMembershipSchema = refineDiscount(
  z
  .object({
    memberId: z.uuid(),
    planId: z.uuid('Pick a plan'),
    branchId: z.uuid('Pick a branch'),
    startDate: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value ? value : null))
      .refine(
        (value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value),
        'Enter the date as YYYY-MM-DD'
      ),
    discountPaisa: z
      .string()
      .trim()
      .optional()
      .transform((value) => value ?? '')
      .pipe(z.union([z.literal(''), rupeesSchema]))
      .transform((value) => (value === '' ? 0 : value)),
    discountReason: discountReasonSchema,
    discountNote: discountNoteSchema,
    amountPaidPaisa: z
      .string()
      .trim()
      .optional()
      .transform((value) => value ?? '')
      .pipe(z.union([z.literal(''), rupeesSchema]))
      .transform((value) => (value === '' ? 0 : value)),
    method: paymentMethodSchema.default('cash'),
    referenceNo: referenceSchema,
    notes: notesSchema,
  })
  .refine(
    (value) => value.amountPaidPaisa === 0 || requireReferenceForDigital(value),
    { message: 'Enter the transaction reference', path: ['referenceNo'] }
  )
)

export const recordPaymentSchema = z
  .object({
    invoiceId: z.uuid(),
    amountPaisa: rupeesSchema,
    method: paymentMethodSchema.default('cash'),
    referenceNo: referenceSchema,
    notes: notesSchema,
  })
  .refine(requireReferenceForDigital, {
    message: 'Enter the transaction reference',
    path: ['referenceNo'],
  })

export const refundPaymentSchema = z.object({
  paymentId: z.uuid(),
  amountPaisa: rupeesSchema,
  reason: z.string().trim().min(3, 'Say why the money is going back').max(500),
  method: paymentMethodSchema.optional(),
  referenceNo: referenceSchema,
})

/**
 * Reversing a payment that never arrived. The amount is what did NOT come in,
 * not what was kept: an entry rung up at 2,500 against 1,000 in hand is
 * corrected by taking 1,500 back, and the invoice falls to part paid on its
 * own. Left empty, the whole entry goes back, which is the old behaviour and
 * still the common one.
 */
export const reversePaymentSchema = z.object({
  paymentId: z.uuid(),
  reason: z.string().trim().min(3, 'Say why it is being reversed').max(500),
  amountPaisa: z
    .string()
    .trim()
    .optional()
    .transform((value) => value ?? '')
    .pipe(z.union([z.literal(''), rupeesSchema]))
    .transform((value) => (value === '' ? null : value)),
})

export const membershipIdSchema = z.object({ membershipId: z.uuid() })

export const freezeMembershipSchema = membershipIdSchema.extend({
  notes: notesSchema,
})

/**
 * Moving the window of a membership already sold. The reason is mandatory: free
 * days are money, and the row keeps the sentence that explains them.
 *
 * The end date is nullable because a session pack can be sold without one; the
 * RPC refuses a null against a membership that has an end date, and vice versa.
 */
const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date as YYYY-MM-DD')

export const adjustMembershipDatesSchema = membershipIdSchema.extend({
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional().transform((value) => value ?? null),
  reason: z.string().trim().min(3, 'Say why the dates are changing').max(500),
})

export const cancelMembershipSchema = membershipIdSchema.extend({
  reason: z.string().trim().min(3, 'Say why it is being cancelled').max(500),
})

export const collectionQuerySchema = z.object({
  on: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  branchId: z.uuid().optional(),
})

export const arrearsQuerySchema = z.object({
  branchId: z.uuid().optional(),
  bucket: z.enum(['0-30', '31-60', '61-90', '90+']).optional(),
})

export type RenewMembershipInput = z.infer<typeof renewMembershipSchema>
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>
