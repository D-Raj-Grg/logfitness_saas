import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type RenewalRequestRow = Database['public']['Tables']['renewal_requests']['Row']
export type RenewalRequestStatus = Database['public']['Enums']['renewal_request_status']

/**
 * A pending request with the member it is about. The member half comes from
 * member_overview, so the desk sees the phone on the record next to the one
 * typed on the balance page, and the plan the request is asking to extend.
 */
export type PendingRenewalRequest = RenewalRequestRow & {
  member: {
    id: string
    full_name: string
    member_code: string
    phone: string
    current_plan_name: string | null
    membership_end_date: string | null
    days_to_expiry: number | null
    home_branch_id: string
    card_no: number | null
  } | null
}

type OverviewSlice = NonNullable<PendingRenewalRequest['member']>

function unwrap<T>(result: {
  data: unknown
  error: { message: string; code?: string } | null
}) {
  if (result.error) throw result.error
  return result.data as T
}

const OVERVIEW_COLUMNS =
  'id, full_name, member_code, phone, current_plan_name, membership_end_date, days_to_expiry, home_branch_id, card_no'

/**
 * Everyone waiting, newest ask first. `branchIds` is the header's branch
 * scope, the same filter the member list applies: null means every branch
 * RLS allows. The view cannot be embedded from the table (no foreign key to a
 * view), so the member half is a second read keyed by member id.
 */
export async function listPendingRenewalRequests(
  branchIds?: string[] | null
): Promise<PendingRenewalRequest[]> {
  const supabase = await createClient()

  const requests =
    unwrap<RenewalRequestRow[]>(
      await supabase
        .from('renewal_requests')
        .select('*')
        .eq('status', 'pending')
        .order('last_requested_at', { ascending: false })
    ) ?? []
  if (requests.length === 0) return []

  let overview = supabase
    .from('member_overview')
    .select(OVERVIEW_COLUMNS)
    .in('id', [...new Set(requests.map((row) => row.member_id))])
  if (branchIds) overview = overview.in('home_branch_id', branchIds)

  const members = new Map(
    (unwrap<OverviewSlice[]>(await overview) ?? []).map((member) => [member.id, member])
  )

  // A request whose member fell outside the branch filter is not on this
  // screen; one whose member could not be read at all is still listed, so a
  // waiting member is never silently dropped.
  return requests
    .filter((row) => !branchIds || members.has(row.member_id))
    .map((row) => ({ ...row, member: members.get(row.member_id) ?? null }))
}

/** The badge on the member list. A count, not the rows. */
export async function countPendingRenewalRequests(): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('renewal_requests')
    .select('id', { head: true, count: 'exact' })
    .eq('status', 'pending')
  if (error) throw error
  return count ?? 0
}

/** Every request this member has made, newest first, whatever became of it. */
export async function listRenewalRequestsForMember(memberId: string) {
  const supabase = await createClient()
  return (
    unwrap<RenewalRequestRow[]>(
      await supabase
        .from('renewal_requests')
        .select('*')
        .eq('member_id', memberId)
        .order('last_requested_at', { ascending: false })
    ) ?? []
  )
}

/** Done or rejected, by the desk. The RPC refuses a request already closed. */
export async function handleRenewalRequest(
  id: string,
  status: Exclude<RenewalRequestStatus, 'pending'>,
  note?: string
) {
  const supabase = await createClient()
  return unwrap<RenewalRequestRow>(
    await supabase.rpc('handle_renewal_request', {
      p_request_id: id,
      p_status: status,
      ...(note ? { p_note: note } : {}),
    })
  )
}
