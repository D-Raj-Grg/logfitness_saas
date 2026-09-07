import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type VisitorRow = Database['public']['Tables']['visitors']['Row']
export type VisitorInsert = Database['public']['Tables']['visitors']['Insert']
export type VisitorUpdate = Database['public']['Tables']['visitors']['Update']
export type VisitorKind = Database['public']['Enums']['visitor_kind']
export type VisitorStatus = Database['public']['Enums']['visitor_status']

export type VisitorListFilter = {
  /** null = every branch RLS allows, which is what an owner sees by default. */
  branchIds: string[] | null
  status?: VisitorStatus | 'open'
  kind?: VisitorKind
  /** Free text over name and phone. */
  q?: string
  page: number
  pageSize: number
}

export type VisitorListResult = {
  rows: VisitorRow[]
  total: number
  page: number
  pageSize: number
}

/**
 * The log, newest visit first. RLS bounds it to the org; `branchIds` is the
 * branch switcher's filter on top of that. `total` counts the whole filtered
 * set, not the page, so the footer can say what is being left out.
 */
export async function listVisitors(filter: VisitorListFilter): Promise<VisitorListResult> {
  const supabase = await createClient()

  let request = supabase
    .from('visitors')
    // Branch and plan names are resolved on the page from the lists it already
    // loads, rather than through an embed: two composite foreign keys point at
    // the same rows and the join hint is a worse thing to maintain than a map.
    .select('*', { count: 'exact' })
    .order('visited_on', { ascending: false })
    .order('created_at', { ascending: false })
    // The last tiebreak is what makes paging safe: rows written in one
    // transaction share created_at, and without a unique final sort key a row
    // can land on two pages while another lands on none.
    .order('id', { ascending: false })

  if (filter.branchIds) {
    request = request.in('branch_id', filter.branchIds)
  }

  // "Open" is the working view: everyone who has not been dealt with yet.
  if (filter.status === 'open') {
    request = request.in('status', ['new', 'contacted'])
  } else if (filter.status) {
    request = request.eq('status', filter.status)
  }

  if (filter.kind) {
    request = request.eq('kind', filter.kind)
  }

  const term = filter.q?.trim()
  if (term) {
    const escaped = term.replace(/[%_,()]/g, ' ').trim()
    if (escaped) {
      request = request.or(`full_name.ilike.%${escaped}%,phone.ilike.${escaped}%`)
    }
  }

  const from = (filter.page - 1) * filter.pageSize
  const { data, error, count } = await request.range(from, from + filter.pageSize - 1)

  if (error) throw error

  return {
    rows: data ?? [],
    total: count ?? 0,
    page: filter.page,
    pageSize: filter.pageSize,
  }
}

export async function getVisitor(visitorId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('visitors')
    .select('*')
    .eq('id', visitorId)
    .maybeSingle()

  if (error) throw error
  return data
}

/**
 * `visited_on` is optional here although the column is not null: the insert
 * trigger fills it from the org's own today when it is absent, which is the
 * answer for a seed and for the mobile app. The generated Insert type cannot
 * know about the trigger.
 */
export async function insertVisitor(
  values: Omit<VisitorInsert, 'visited_on'> & { visited_on?: string }
) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('visitors')
    .insert(values as VisitorInsert)
    .select('id')
    .single()

  if (error) throw error
  return data
}

export async function updateVisitor(visitorId: string, values: VisitorUpdate) {
  const supabase = await createClient()

  const { error } = await supabase.from('visitors').update(values).eq('id', visitorId)

  if (error) throw error
}

export async function deleteVisitor(visitorId: string) {
  const supabase = await createClient()

  const { error } = await supabase.from('visitors').delete().eq('id', visitorId)

  if (error) throw error
}

/**
 * Marks a visitor as the member they became. Called after register_member has
 * already returned an id -- see the note in app/(app)/members/actions.ts about
 * why a failure here does not undo the registration.
 */
export async function convertVisitor(visitorId: string, memberId: string) {
  const supabase = await createClient()

  const { error } = await supabase.rpc('convert_visitor', {
    p_visitor_id: visitorId,
    p_member_id: memberId,
  })

  if (error) throw error
}
