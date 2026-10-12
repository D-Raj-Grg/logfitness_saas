'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import {
  registerDevice as registerDeviceRpc,
  rotateDeviceKey as rotateDeviceKeyRpc,
  updateDevice,
} from '@/lib/db/devices'
import { rpcErrorMessage } from '@/lib/rpc-error'
import {
  deviceIdSchema,
  registerDeviceSchema,
  renameDeviceSchema,
  setDeviceStatusSchema,
} from '@/lib/validation/devices'

export type DeviceFormState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[] | undefined>
  /**
   * The plaintext device key, present only in the response to the register or
   * rotate that minted it. It lives in this one action result and the client
   * state holding it -- never in the database, a cookie, or the URL -- so once
   * the screen is closed it is gone for good.
   */
  key?: string
  deviceName?: string
}

const DEVICE_ROLES = ['owner', 'manager'] as const

export async function registerDevice(
  _prevState: DeviceFormState,
  formData: FormData
): Promise<DeviceFormState> {
  await requireRole(...DEVICE_ROLES)

  const parsed = registerDeviceSchema.safeParse({
    branchId: formData.get('branchId'),
    name: formData.get('name'),
  })
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  let registered
  try {
    registered = await registerDeviceRpc(parsed.data)
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The reader could not be registered.') }
  }

  revalidatePath('/settings/devices')
  return {
    success: `${registered.name} registered.`,
    key: registered.key,
    deviceName: registered.name,
  }
}

export async function rotateDeviceKey(
  _prevState: DeviceFormState,
  formData: FormData
): Promise<DeviceFormState> {
  await requireRole(...DEVICE_ROLES)

  const parsed = deviceIdSchema.safeParse({ deviceId: formData.get('deviceId') })
  if (!parsed.success) return { error: 'That reader does not exist.' }

  let rotated
  try {
    rotated = await rotateDeviceKeyRpc(parsed.data.deviceId)
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The key could not be replaced.') }
  }

  revalidatePath('/settings/devices')
  return { success: 'New key issued. The old one stopped working just now.', key: rotated.key }
}

export async function renameDevice(
  _prevState: DeviceFormState,
  formData: FormData
): Promise<DeviceFormState> {
  await requireRole(...DEVICE_ROLES)

  const parsed = renameDeviceSchema.safeParse({
    deviceId: formData.get('deviceId'),
    name: formData.get('name'),
  })
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  try {
    await updateDevice({ deviceId: parsed.data.deviceId, name: parsed.data.name })
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The reader could not be renamed.') }
  }

  // The name is what the attendance log shows for a door check-in.
  revalidatePath('/settings/devices')
  revalidatePath('/check-in')
  return { success: 'Renamed.' }
}

export async function setDeviceStatus(
  _prevState: DeviceFormState,
  formData: FormData
): Promise<DeviceFormState> {
  await requireRole(...DEVICE_ROLES)

  const parsed = setDeviceStatusSchema.safeParse({
    deviceId: formData.get('deviceId'),
    status: formData.get('status'),
  })
  if (!parsed.success) return { error: 'That reader does not exist.' }

  try {
    await updateDevice({ deviceId: parsed.data.deviceId, status: parsed.data.status })
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The reader could not be changed.') }
  }

  revalidatePath('/settings/devices')
  return {
    success: parsed.data.status === 'disabled' ? 'Reader disabled.' : 'Reader enabled.',
  }
}
