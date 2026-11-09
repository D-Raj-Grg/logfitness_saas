import { z } from 'zod'

export const memberPinIdSchema = z.uuid()

/** A custom PIN: 4 to 6 digits, nothing else. The RPC enforces the same rule. */
export const customPinSchema = z
  .string()
  .regex(/^\d{4,6}$/, 'Enter 4 to 6 digits')
