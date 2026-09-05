import { z } from 'zod'

export const attendanceMethodSchema = z.enum(['manual', 'qr', 'card', 'biometric'])

const notesSchema = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((value) => (value ? value : null))

/**
 * A second visit on the same day is deliberate, so the reason is required the
 * moment the override flag is set. The database enforces the same rule; this
 * only turns it into a field error instead of a thrown RPC message.
 */
export const checkInSchema = z
  .object({
    memberId: z.uuid('Pick a member'),
    branchId: z.uuid('Pick a branch'),
    method: attendanceMethodSchema.default('manual'),
    override: z
      .union([z.literal('on'), z.literal('true'), z.literal('false'), z.literal('')])
      .optional()
      .transform((value) => value === 'on' || value === 'true'),
    overrideReason: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => (value ? value : null)),
    notes: notesSchema,
  })
  .refine((value) => !value.override || Boolean(value.overrideReason), {
    message: 'Say why they are being let in again today',
    path: ['overrideReason'],
  })

export const checkOutSchema = z.object({
  attendanceId: z.uuid(),
})

/** The check-in screen's own search box: same fields the member list uses. */
export const checkInSearchSchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
  branchId: z.uuid().optional(),
})

export const inGymQuerySchema = z.object({
  branchId: z.uuid().optional(),
})

export const absentQuerySchema = z.object({
  branchId: z.uuid().optional(),
  minDays: z.coerce.number().int().min(1).max(365).default(14),
  band: z.enum(['14-29 days', '30-59 days', '60+ days']).optional(),
})

export const attendanceLogQuerySchema = z.object({
  branchId: z.uuid().optional(),
  on: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
})

export type CheckInInput = z.infer<typeof checkInSchema>
export type CheckOutInput = z.infer<typeof checkOutSchema>
export type AbsentQuery = z.infer<typeof absentQuerySchema>
export type AttendanceLogQuery = z.infer<typeof attendanceLogQuerySchema>
export type CheckInSearchQuery = z.infer<typeof checkInSearchSchema>
