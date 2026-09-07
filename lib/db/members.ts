import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import type { MemberListQuery } from '@/lib/validation/members'

export type MemberRow = Database['public']['Tables']['members']['Row']
export type MemberInsert = Database['public']['Tables']['members']['Insert']
export type MemberUpdate = Database['public']['Tables']['members']['Update']

/**
 * One row of the member_overview view. Every column is nullable in the
 * generated types because Postgres cannot prove view columns non-null, so the
 * list narrows the ones that are structurally guaranteed by the view.
 */
export type MemberOverviewRow = Omit<
  Database['public']['Views']['member_overview']['Row'],
  'id' | 'org_id' | 'member_code' | 'full_name' | 'phone' | 'status' | 'home_branch_id' | 'home_branch_name' | 'joined_on' | 'due_paisa'
> & {
  id: string
  org_id: string
  member_code: string
  full_name: string
  phone: string
  status: Database['public']['Enums']['member_status']
  home_branch_id: string
  home_branch_name: string
  joined_on: string
  due_paisa: number
}

export type MemberListResult = {
  rows: MemberOverviewRow[]
  total: number
  page: number
  pageSize: number
}

/**
 * Server-side search, filter, and pagination over the overview view. The
 * search term matches the phone prefix, the member code prefix, or any part of
 * the name -- the three things a front desk is ever told.
 */
export async function listMembers(query: MemberListQuery): Promise<MemberListResult> {
  const supabase = await createClient()

  let request = supabase
    .from('member_overview')
    .select('*', { count: 'exact' })

  // Archived members are hidden everywhere except the filter that asks for
  // them. They are still rows, still auditable, still restorable -- just not in
  // the list the desk works from all day.
  request =
    query.status === 'archived'
      ? request.not('archived_at', 'is', null)
      : request.is('archived_at', null)

  const term = query.q.trim()
  if (term) {
    const escaped = term.replace(/[%_,()]/g, ' ').trim()
    if (escaped) {
      request = request.or(
        `phone.ilike.${escaped}%,member_code.ilike.${escaped}%,full_name.ilike.%${escaped}%`
      )
    }
  }

  if (query.branchId) {
    request = request.eq('home_branch_id', query.branchId)
  }

  switch (query.status) {
    case 'archived':
      break
    case 'active':
    case 'expired':
    case 'frozen':
    case 'left':
      request = request.eq('status', query.status)
      break
    case 'expiring':
      request = request.eq('status', 'active').lte('days_to_expiry', 7)
      break
    case 'dues':
      request = request.gt('due_paisa', 0)
      break
  }

  const from = (query.page - 1) * query.pageSize
  const to = from + query.pageSize - 1

  const { data, error, count } = await request
    .order('full_name')
    .range(from, to)

  if (error) throw error

  return {
    rows: (data ?? []) as MemberOverviewRow[],
    total: count ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  }
}

/**
 * The check-in box. Deliberately not listMembers(): the desk types a phone
 * number and wants a handful of hits back in one round trip, not a paginated
 * page with a count query attached to it.
 */
export async function searchMembersForCheckIn(term: string, limit = 8) {
  const cleaned = term.trim().replace(/[%_,()]/g, ' ').trim()
  if (!cleaned) return [] as MemberOverviewRow[]

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('member_overview')
    .select('*')
    .is('archived_at', null)
    .or(
      `phone.ilike.${cleaned}%,member_code.ilike.${cleaned}%,full_name.ilike.%${cleaned}%`
    )
    .order('full_name')
    .limit(limit)

  if (error) throw error
  return (data ?? []) as MemberOverviewRow[]
}

export async function getMember(memberId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('id', memberId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function getMemberOverview(memberId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('member_overview')
    .select('*')
    .eq('id', memberId)
    .maybeSingle()

  if (error) throw error
  return data as MemberOverviewRow | null
}

export type RegisterMemberResult = {
  member_id: string
  member_code: string
  sold: boolean
  /** Present only when a plan was sold. Mirrors renew_membership's own shape. */
  membership_id?: string
  invoice_id?: string
  invoice_no?: string
  payment_id?: string | null
  start_date?: string
  end_date?: string | null
  total_paisa?: number
  due_paisa?: number
}

/**
 * Registration and the optional first sale, in one transaction. A sale that is
 * refused registers nobody -- see the register_member migration for why that
 * matters at the desk.
 *
 * The error carries a `hint` of 'member' or 'sale' saying which half refused,
 * which is how the Server Action lands the message on the right field.
 */
export async function registerMember(args: {
  fullName: string
  phone: string
  homeBranchId: string
  email?: string | null
  dateOfBirth?: string | null
  gender?: Database['public']['Enums']['member_gender'] | null
  address?: string | null
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
  notes?: string | null
  planId?: string | null
  discountPaisa?: number
  amountPaidPaisa?: number
  method?: Database['public']['Enums']['payment_method']
  referenceNo?: string | null
  /** Sale only. Null lets the RPC resolve it, which for a new member is today. */
  startDate?: string | null
}): Promise<RegisterMemberResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('register_member', {
    p_full_name: args.fullName,
    p_phone: args.phone,
    p_home_branch_id: args.homeBranchId,
    p_email: args.email ?? undefined,
    p_date_of_birth: args.dateOfBirth ?? undefined,
    p_gender: args.gender ?? undefined,
    p_address: args.address ?? undefined,
    p_emergency_contact_name: args.emergencyContactName ?? undefined,
    p_emergency_contact_phone: args.emergencyContactPhone ?? undefined,
    p_notes: args.notes ?? undefined,
    p_plan_id: args.planId ?? undefined,
    p_discount_paisa: args.discountPaisa ?? 0,
    p_amount_paid_paisa: args.amountPaidPaisa ?? 0,
    p_method: args.method ?? 'cash',
    p_reference_no: args.referenceNo ?? undefined,
    p_start_date: args.startDate ?? undefined,
  })

  if (error) throw error
  return data as unknown as RegisterMemberResult
}

export async function insertMember(values: MemberInsert) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('members')
    .insert(values)
    .select('id, member_code')
    .single()

  if (error) throw error
  return data
}

export async function updateMember(memberId: string, values: MemberUpdate) {
  const supabase = await createClient()

  const { error } = await supabase.from('members').update(values).eq('id', memberId)

  if (error) throw error
}

/**
 * Invites a member to the mobile app. This is a single RPC, not a column
 * update, because invite_member() also decides -- under the caller's own RLS
 * -- whether this member may still be invited and who gets credited as the
 * inviter.
 */
export async function inviteMemberToApp(memberId: string, email: string) {
  const supabase = await createClient()

  const { error } = await supabase.rpc('invite_member', {
    p_member_id: memberId,
    p_email: email,
  })

  if (error) throw error
}

/**
 * Archiving hides a member from every default list without touching a single
 * membership, invoice or payment. Restoring puts them back. Both are RPCs
 * because the audit trail and the "already archived" rule belong next to the
 * write, where the Flutter app will reach them too.
 */
export async function archiveMember(memberId: string, reason?: string | null) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('archive_member', {
    p_member_id: memberId,
    p_reason: reason ?? undefined,
  })

  if (error) throw error
  return data as unknown as { member_id: string; archived_at: string }
}

export async function restoreMember(memberId: string) {
  const supabase = await createClient()

  const { error } = await supabase.rpc('restore_member', { p_member_id: memberId })

  if (error) throw error
}

/**
 * The real delete, and the reason archiving exists. The row goes, and the
 * cascade takes its memberships, invoices and payments with it. No RPC: the
 * "owners delete members" policy is the whole rule, so a non-owner's delete
 * simply matches nothing -- which is why the caller checks the count rather
 * than trusting a silent success.
 */
export async function deleteMember(memberId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('members')
    .delete()
    .eq('id', memberId)
    .select('id')

  if (error) throw error
  return (data ?? []).length > 0
}

/** Counts for the dashboard tiles: expiring within 7 days, expired, frozen. */
export async function memberStatusCounts(branchId?: string) {
  const supabase = await createClient()

  const base = () => {
    let request = supabase
      .from('member_overview')
      .select('id', { count: 'exact', head: true })
      .is('archived_at', null)
    if (branchId) request = request.eq('home_branch_id', branchId)
    return request
  }

  const [active, expiring, expired, frozen, dues] = await Promise.all([
    base().eq('status', 'active'),
    base().eq('status', 'active').lte('days_to_expiry', 7),
    base().eq('status', 'expired'),
    base().eq('status', 'frozen'),
    base().gt('due_paisa', 0),
  ])

  for (const result of [active, expiring, expired, frozen, dues]) {
    if (result.error) throw result.error
  }

  return {
    active: active.count ?? 0,
    expiring: expiring.count ?? 0,
    expired: expired.count ?? 0,
    frozen: frozen.count ?? 0,
    withDues: dues.count ?? 0,
  }
}
