import { z } from 'zod'

import { cardUidSchema } from '@/lib/validation/member-cards'

export const assignStaffCardSchema = z.object({
  staffId: z.uuid(),
  cardUid: cardUidSchema,
  replace: z
    .union([z.literal('true'), z.literal('false'), z.literal('')])
    .optional()
    .transform((value) => value === 'true'),
})

export const revokeStaffCardSchema = z.object({
  staffId: z.uuid(),
  reason: z
    .string()
    .trim()
    .min(1, 'Say why the card is being revoked')
    .max(500, 'Keep the reason to 500 characters'),
})
