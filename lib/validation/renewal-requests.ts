import { z } from 'zod'

export const handleRenewalRequestSchema = z.object({
  id: z.uuid(),
  status: z.enum(['done', 'rejected']),
  note: z
    .string()
    .trim()
    .max(500, 'Keep the note to 500 characters')
    .optional()
    .transform((value) => value || undefined),
})

export type HandleRenewalRequestInput = z.infer<typeof handleRenewalRequestSchema>
