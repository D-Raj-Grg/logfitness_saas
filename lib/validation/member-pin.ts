import { z } from 'zod'

export const memberPinIdSchema = z.uuid()

/** A custom PIN: exactly 6 digits, nothing else. The RPC enforces the same rule. */
export const customPinSchema = z
  .string()
  .regex(/^\d{6}$/, 'Exactly 6 digits')
