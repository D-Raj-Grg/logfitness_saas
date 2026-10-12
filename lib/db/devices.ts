import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type DeviceStatus = Database['public']['Enums']['device_status']

/**
 * What the console may see of a reader. key_hash is deliberately absent: the
 * select below names its columns, so the hash never leaves the database even
 * though RLS would let staff read it.
 */
export type DeviceListRow = {
  id: string
  branch_id: string
  name: string
  key_prefix: string
  status: DeviceStatus
  last_seen_at: string | null
  created_at: string
}

/** register_device() hands back the plaintext key exactly once. */
export type RegisteredDevice = { device_id: string; name: string; key: string }

/** rotate_device_key() likewise: the new key, once. */
export type RotatedDeviceKey = { device_id: string; key: string }

function unwrap<T>(result: {
  data: unknown
  error: { message: string; code?: string } | null
}) {
  if (result.error) throw result.error
  return result.data as T
}

/**
 * Readers the caller can manage. RLS shows every reader in the org to any
 * staff member, but the write RPCs refuse a manager outside their branches, so
 * a manager's list is narrowed to match what they can actually change.
 */
export async function listDevices(branchIds?: string[] | null): Promise<DeviceListRow[]> {
  const supabase = await createClient()

  let request = supabase
    .from('devices')
    .select('id, branch_id, name, key_prefix, status, last_seen_at, created_at')
    .order('name')

  if (branchIds) request = request.in('branch_id', branchIds)

  return unwrap<DeviceListRow[]>(await request) ?? []
}

export async function registerDevice(args: { branchId: string; name: string }) {
  const supabase = await createClient()
  return unwrap<RegisteredDevice>(
    await supabase.rpc('register_device', {
      p_branch_id: args.branchId,
      p_name: args.name,
    })
  )
}

export async function rotateDeviceKey(deviceId: string) {
  const supabase = await createClient()
  return unwrap<RotatedDeviceKey>(
    await supabase.rpc('rotate_device_key', { p_device_id: deviceId })
  )
}

/** Rename and/or enable/disable. Undefined leaves that field as it is. */
export async function updateDevice(args: {
  deviceId: string
  name?: string
  status?: DeviceStatus
}) {
  const supabase = await createClient()
  return unwrap<Omit<Database['public']['Tables']['devices']['Row'], 'key_hash'>>(
    await supabase.rpc('update_device', {
      p_device_id: args.deviceId,
      p_name: args.name,
      p_status: args.status,
    })
  )
}
