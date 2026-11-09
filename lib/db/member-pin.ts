import 'server-only'

import { createClient } from '@/lib/supabase/server'

/** What the desk may know about a member's app PIN. Never the PIN itself. */
export type MemberPinStatus = {
  has_pin: boolean
  /** Set only while the member is locked out after too many wrong PINs. */
  locked_until: string | null
  set_at: string | null
}

export type SetMemberPinResult = {
  result: 'ok'
  /** Present only when the database generated the PIN. Shown once, never stored. */
  pin?: string
}

export type ClearMemberPinResult = {
  result: 'ok'
  had_pin: boolean
}

function unwrap<T>(result: {
  data: unknown
  error: { message: string; code?: string } | null
}) {
  if (result.error) throw result.error
  return result.data as T
}

export async function getMemberPinStatus(memberId: string): Promise<MemberPinStatus> {
  const supabase = await createClient()
  const raw = unwrap<Partial<MemberPinStatus> | null>(
    await supabase.rpc('member_pin_status', { p_member_id: memberId })
  )
  return {
    has_pin: Boolean(raw?.has_pin),
    locked_until: raw?.locked_until ?? null,
    set_at: raw?.set_at ?? null,
  }
}

/**
 * Set the member's PIN. With no `pin` the database generates six digits and
 * returns them in this one response; with one it must be 4-6 digits or the RPC
 * raises. Either way it also clears any lock. The caller must not log the
 * result.
 */
export async function setMemberPin(args: {
  memberId: string
  pin?: string
}): Promise<SetMemberPinResult> {
  const supabase = await createClient()
  return unwrap<SetMemberPinResult>(
    await supabase.rpc('set_member_pin', {
      p_member_id: args.memberId,
      ...(args.pin ? { p_pin: args.pin } : {}),
    })
  )
}

export async function clearMemberPin(memberId: string): Promise<ClearMemberPinResult> {
  const supabase = await createClient()
  return unwrap<ClearMemberPinResult>(
    await supabase.rpc('clear_member_pin', { p_member_id: memberId })
  )
}
