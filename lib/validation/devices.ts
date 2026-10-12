import { z } from 'zod'

export const deviceStatusSchema = z.enum(['active', 'disabled'])

/** Mirrors the database rule: 1 to 60 characters once trimmed. */
export const deviceNameSchema = z
  .string()
  .trim()
  .min(1, 'Name the reader, e.g. "Front door"')
  .max(60, 'Keep the name to 60 characters')

export const registerDeviceSchema = z.object({
  branchId: z.uuid('Pick a branch'),
  name: deviceNameSchema,
})

export const deviceIdSchema = z.object({ deviceId: z.uuid() })

export const renameDeviceSchema = z.object({
  deviceId: z.uuid(),
  name: deviceNameSchema,
})

export const setDeviceStatusSchema = z.object({
  deviceId: z.uuid(),
  status: deviceStatusSchema,
})
