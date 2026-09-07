import { z } from 'zod'

import { phoneSchema } from '@/lib/validation/members'
import { pageSchema, pageSizeSchema } from '@/lib/validation/pagination'

/**
 * A day, or nothing. A cleared date input arrives as '' and means "today" --
 * the insert trigger fills it from the org's own today -- so it must not read
 * as a malformed date.
 */
const optionalIsoDate = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .refine(
    (value) => value === undefined || /^\d{4}-\d{2}-\d{2}$/.test(value),
    'Enter the date as YYYY-MM-DD'
  )

export const visitorKindSchema = z.enum(['enquiry', 'guest'])

/**
 * `converted` is never chosen from a form: it is set by convert_visitor when a
 * member actually exists, and the table's check constraint agrees.
 */
export const visitorStatusChoiceSchema = z.enum(['new', 'contacted', 'lost'])

export const visitorSchema = z.object({
  fullName: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  phone: phoneSchema,
  branchId: z.uuid('Pick a branch'),
  kind: visitorKindSchema.default('enquiry'),
  // Defaults to today at the desk. The database fills it when absent, which is
  // the answer for a seed or the mobile app; the form always sends one.
  visitedOn: optionalIsoDate,
  note: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((value) => (value ? value : null)),
  interestedPlanId: z
    .union([z.uuid(), z.literal('')])
    .optional()
    .transform((value) => (value ? value : null)),
})

/**
 * The list screen's own query. `view` is the status filter the desk actually
 * asks for -- who still needs calling back -- rather than the raw enum.
 */
export const visitorListQuerySchema = z.object({
  view: z.enum(['open', 'all', 'converted', 'lost']).catch('open').default('open'),
  kind: z.enum(['all', 'enquiry', 'guest']).catch('all').default('all'),
  q: z.string().trim().max(120).optional().default(''),
  page: pageSchema,
  pageSize: pageSizeSchema,
})

export type VisitorListQuery = z.infer<typeof visitorListQuerySchema>

export const visitorIdSchema = z.object({ visitorId: z.uuid() })

export const visitorStatusSchema = z.object({
  visitorId: z.uuid(),
  status: visitorStatusChoiceSchema,
})

export const convertVisitorSchema = z.object({
  visitorId: z.uuid(),
  memberId: z.uuid(),
})

export type VisitorInput = z.infer<typeof visitorSchema>
