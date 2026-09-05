import { z } from 'zod'

import { emailSchema } from '@/lib/validation/auth'

export const staffRoleSchema = z.enum([
  'owner',
  'manager',
  'front_desk',
  'trainer',
])

export const inviteStaffSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(120, 'Name is too long'),
    email: emailSchema,
    phone: z
      .string()
      .trim()
      .max(32, 'Phone number is too long')
      .optional()
      .transform((value) => (value ? value : null)),
    role: staffRoleSchema,
    branchIds: z.array(z.uuid()).default([]),
  })
  // Mirrors the validate_staff_branches trigger. Checking here too turns a
  // database exception into a message next to the right field.
  .refine(
    (value) => value.role !== 'manager' || value.branchIds.length >= 1,
    { message: 'Assign at least one branch', path: ['branchIds'] }
  )
  .refine(
    (value) =>
      !['front_desk', 'trainer'].includes(value.role) ||
      value.branchIds.length === 1,
    { message: 'Assign exactly one branch', path: ['branchIds'] }
  )

export const staffStatusSchema = z.enum(['invited', 'active', 'inactive'])

export const setStaffStatusSchema = z.object({
  staffId: z.uuid(),
  status: staffStatusSchema,
})

export type InviteStaffInput = z.infer<typeof inviteStaffSchema>
