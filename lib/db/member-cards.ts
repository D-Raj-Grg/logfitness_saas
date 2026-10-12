import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type MemberCardRow = Database['public']['Tables']['member_cards']['Row']

/** A tap from a card no member holds yet, with the reader that saw it. */
export type UnassignedCardScan = {
  id: string
  card_uid: string
  branch_id: string
  device_id: string
  last_seen_at: string
  scan_count: number
  devices: { name: string } | null
}

function unwrap<T>(result: {
  data: unknown
  error: { message: string; code?: string } | null
}) {
  if (result.error) throw result.error
  return result.data as T
}

/**
 * Every card the member has held, newest first. Revoked rows are the history;
 * the live card, if any, is the one with no revoked_at (at most one exists --
 * a partial unique index), so the profile derives it from this list rather
 * than spending a second query.
 */
export async function listMemberCards(memberId: string) {
  const supabase = await createClient()
  return (
    unwrap<MemberCardRow[]>(
      await supabase
        .from('member_cards')
        .select('*')
        .eq('member_id', memberId)
        .order('assigned_at', { ascending: false })
    ) ?? []
  )
}

/**
 * The enrollment inbox: the ten most recent taps from unknown cards. Pass the
 * caller's branch ids to narrow it (RLS already limits it to branches they can
 * reach); null means every branch, which is what an owner sees.
 */
export async function listUnassignedCardScans(branchIds?: string[] | null) {
  const supabase = await createClient()

  let request = supabase
    .from('unassigned_card_scans')
    .select('id, card_uid, branch_id, device_id, last_seen_at, scan_count, devices(name)')
    .order('last_seen_at', { ascending: false })
    .limit(10)

  if (branchIds) request = request.in('branch_id', branchIds)

  return unwrap<UnassignedCardScan[]>(await request) ?? []
}

export async function assignMemberCard(args: {
  memberId: string
  cardUid: string
  replace?: boolean
}) {
  const supabase = await createClient()
  return unwrap<MemberCardRow>(
    await supabase.rpc('assign_member_card', {
      p_member_id: args.memberId,
      p_card_uid: args.cardUid,
      p_replace: args.replace ?? false,
    })
  )
}

export async function revokeMemberCard(args: { memberId: string; reason: string }) {
  const supabase = await createClient()
  return unwrap<MemberCardRow>(
    await supabase.rpc('revoke_member_card', {
      p_member_id: args.memberId,
      p_reason: args.reason,
    })
  )
}
