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

/** Counts for the dashboard tiles: expiring within 7 days, expired, frozen. */
export async function memberStatusCounts(branchId?: string) {
  const supabase = await createClient()

  const base = () => {
    let request = supabase
      .from('member_overview')
      .select('id', { count: 'exact', head: true })
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
