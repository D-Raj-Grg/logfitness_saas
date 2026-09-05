import { z } from 'zod'

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

export const memberListQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
  status: z.enum(['active', 'expired', 'frozen', 'left', 'expiring', 'dues']).optional(),
  branchId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
})

export type MemberInput = z.infer<typeof memberSchema>
export type MemberListQuery = z.infer<typeof memberListQuerySchema>
