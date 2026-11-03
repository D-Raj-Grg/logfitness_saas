import type { UnassignedCardScan } from '@/lib/db/member-cards'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type StaffCardRow = Database['public']['Tables']['staff_cards']['Row'] & {
  /** Who handed the card over; null when that person has since been removed. */
  assigner: { full_name: string } | null
}

function unwrap<T>(result: {
  data: unknown
  error: { message: string; code?: string } | null
}) {
  if (result.error) throw result.error
  return result.data as T
}

/**
 * Every card this staff member has held, newest first. Revoked rows are the
 * history; the live one has no revoked_at (a partial unique index allows at
 * most one), so the screen derives it from this list.
 */
export async function listStaffCards(staffId: string) {
  const supabase = await createClient()
  return (
    unwrap<StaffCardRow[]>(
      await supabase
        .from('staff_cards')
        .select('*, assigner:staff!staff_cards_assigned_by_fkey(full_name)')
        .eq('staff_id', staffId)
        .order('assigned_at', { ascending: false })
    ) ?? []
  )
}

/**
 * The enrollment inbox, as the staff dialog sees it: the ten most recent taps
 * from cards nobody holds. A UID already live for a member OR a staff member is
 * dropped even if its scan row survived, because offering it could only end in
 * "That card is already assigned".
 */
export async function listUnassignedCardScansForStaff(branchIds?: string[] | null) {
  const supabase = await createClient()

  let request = supabase
    .from('unassigned_card_scans')
    .select('id, card_uid, branch_id, device_id, last_seen_at, scan_count, devices(name)')
    .order('last_seen_at', { ascending: false })
    .limit(20)

  if (branchIds) request = request.in('branch_id', branchIds)

  const scans = unwrap<UnassignedCardScan[]>(await request) ?? []
  if (scans.length === 0) return scans

  const uids = [...new Set(scans.map((scan) => scan.card_uid))]
  const [memberLive, staffLive] = await Promise.all([
    supabase.from('member_cards').select('card_uid').is('revoked_at', null).in('card_uid', uids),
    supabase.from('staff_cards').select('card_uid').is('revoked_at', null).in('card_uid', uids),
  ])
  const assigned = new Set([
    ...(unwrap<{ card_uid: string }[]>(memberLive) ?? []).map((row) => row.card_uid),
    ...(unwrap<{ card_uid: string }[]>(staffLive) ?? []).map((row) => row.card_uid),
  ])

  return scans.filter((scan) => !assigned.has(scan.card_uid)).slice(0, 10)
}

export async function assignStaffCard(args: {
  staffId: string
  cardUid: string
  replace?: boolean
}) {
  const supabase = await createClient()
  return unwrap<Database['public']['Tables']['staff_cards']['Row']>(
    await supabase.rpc('assign_staff_card', {
      p_staff_id: args.staffId,
      p_card_uid: args.cardUid,
      p_replace: args.replace ?? false,
    })
  )
}

export async function revokeStaffCard(args: { staffId: string; reason: string }) {
  const supabase = await createClient()
  return unwrap<Database['public']['Tables']['staff_cards']['Row']>(
    await supabase.rpc('revoke_staff_card', {
      p_staff_id: args.staffId,
      p_reason: args.reason,
    })
  )
}
