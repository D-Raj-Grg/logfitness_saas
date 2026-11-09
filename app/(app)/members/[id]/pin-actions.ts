'use server'

import { revalidatePath } from 'next/cache'

import { requireRole } from '@/lib/auth'
import {
  clearMemberPin as clearMemberPinRpc,
  getMemberPinStatus as getMemberPinStatusRpc,
  setMemberPin as setMemberPinRpc,
  type MemberPinStatus,
} from '@/lib/db/member-pin'
import { rpcErrorMessage } from '@/lib/rpc-error'
import { customPinSchema, memberPinIdSchema } from '@/lib/validation/member-pin'

export type { MemberPinStatus }

/**
 * A plain result, not form state: these are called straight from the dialog so
 * a generated PIN lives only in that dialog's local state. It is never put in
 * a URL, a toast, a log line or anything the page revalidates.
 */
export type MemberPinResult =
  | { error: string; status?: never; pin?: never }
  | { error?: never; status: MemberPinStatus | null; pin?: string }

const DESK_ROLES = ['owner', 'manager', 'front_desk'] as const

const BAD_MEMBER = 'That member could not be found.'

function revalidateMember(memberId: string) {
  revalidatePath(`/members/${memberId}`)
}

/** Best effort: a failed status read must not hide a PIN that was just made. */
async function freshStatus(memberId: string): Promise<MemberPinStatus | null> {
  try {
    return await getMemberPinStatusRpc(memberId)
  } catch {
    return null
  }
}

export async function getMemberPinStatus(memberId: string): Promise<MemberPinResult> {
  await requireRole(...DESK_ROLES)

  const id = memberPinIdSchema.safeParse(memberId)
  if (!id.success) return { error: BAD_MEMBER }

  try {
    return { status: await getMemberPinStatusRpc(id.data) }
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The PIN status could not be read.') }
  }
}

/** With no `pin`, the database generates one and it comes back once. */
export async function setMemberPin(memberId: string, pin?: string): Promise<MemberPinResult> {
  await requireRole(...DESK_ROLES)

  const id = memberPinIdSchema.safeParse(memberId)
  if (!id.success) return { error: BAD_MEMBER }

  let custom: string | undefined
  if (pin !== undefined) {
    const parsed = customPinSchema.safeParse(pin)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Enter 4 to 6 digits' }
    custom = parsed.data
  }

  let generated: string | undefined
  try {
    const result = await setMemberPinRpc({ memberId: id.data, pin: custom })
    generated = result.pin
  } catch (error) {
    // The RPC's own sentence (a staff-linked member, a bad PIN) is the answer.
    return { error: rpcErrorMessage(error, 'The PIN could not be set.') }
  }

  revalidateMember(id.data)
  const status = await freshStatus(id.data)
  return { status, ...(generated ? { pin: generated } : {}) }
}

export async function clearMemberPin(memberId: string): Promise<MemberPinResult> {
  await requireRole(...DESK_ROLES)

  const id = memberPinIdSchema.safeParse(memberId)
  if (!id.success) return { error: BAD_MEMBER }

  try {
    await clearMemberPinRpc(id.data)
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The PIN could not be removed.') }
  }

  revalidateMember(id.data)
  return { status: (await freshStatus(id.data)) ?? { has_pin: false, locked_until: null, set_at: null } }
}
