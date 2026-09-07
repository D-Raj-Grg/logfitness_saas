import { z } from 'zod'

export const branchSchema = z.object({
  name: z.string().trim().min(1, 'Give the branch a name.').max(120),
  address: z.string().trim().max(400).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
})

export type BranchInput = z.infer<typeof branchSchema>
