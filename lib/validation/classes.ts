import { z } from 'zod'

import type { Database } from '@/lib/types/database'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** One weekly slot. Matches validate_class_recurrence(): 0 = Sunday. */
export const recurrenceSlotSchema = z
  .object({
    day_of_week: z.coerce.number().int().min(0).max(6),
    start_time: z.string().regex(TIME, 'Use HH:MM'),
    end_time: z.string().regex(TIME, 'Use HH:MM'),
  })
  .refine((slot) => slot.start_time < slot.end_time, {
    message: 'A slot must end after it starts',
    path: ['end_time'],
  })

export type RecurrenceSlot = z.infer<typeof recurrenceSlotSchema>

const recurrenceJsonSchema = z
  .string()
  .transform((value, ctx) => {
    try {
      return JSON.parse(value) as unknown
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Invalid schedule' })
      return z.NEVER
    }
  })
  .pipe(z.array(recurrenceSlotSchema).max(28, 'Too many slots'))

export const classSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null),
  branchId: z.uuid('Pick a branch'),
  trainerId: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.uuid().nullable()),
  capacity: z.coerce.number().int().min(1, 'At least 1').max(1000),
  room: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
  recurrence: recurrenceJsonSchema,
  isActive: z.boolean(),
})

export const updateClassSchema = classSchema.extend({ classId: z.uuid() })

export const rescheduleSchema = z
  .object({
    sessionId: z.uuid(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'A session must end after it starts',
  })

export const bookSchema = z.object({
  sessionId: z.uuid(),
  memberId: z.uuid(),
})

export const cancelBookingSchema = z.object({
  bookingId: z.uuid(),
  reason: z.string().trim().max(200).optional(),
})

export const weekSchema = z.iso.date()

export type ClassRow = Database['public']['Tables']['classes']['Row']

export function recurrenceOf(row: Pick<ClassRow, 'recurrence'>): RecurrenceSlot[] {
  return Array.isArray(row.recurrence) ? (row.recurrence as unknown as RecurrenceSlot[]) : []
}
