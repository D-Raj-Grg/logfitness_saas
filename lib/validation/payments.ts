import { z } from 'zod'

import { rupeesSchema } from '@/lib/validation/plans'

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

export const renewMembershipSchema = z
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

export const membershipIdSchema = z.object({ membershipId: z.uuid() })

export const freezeMembershipSchema = membershipIdSchema.extend({
  notes: notesSchema,
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
