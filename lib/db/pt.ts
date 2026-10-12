import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type PtSessionStatus = Database['public']['Enums']['pt_session_status']

export type PtSessionListRow = {
  id: string
  branch_id: string
  trainer_id: string
  member_id: string
  membership_id: string | null
  scheduled_at: string
  duration_minutes: number
  status: PtSessionStatus
  notes: string | null
  members: { full_name: string; member_code: string } | null
  staff: { full_name: string } | null
  memberships: { plan_name: string; plan_type: string; sessions_remaining: number | null } | null
}

/** Sessions from `since` onward (ISO timestamp), soonest first. RLS bounds the org. */
export async function listPtSessions(args: {
  branchIds: string[] | null
  trainerId?: string | null
  since: string
}): Promise<PtSessionListRow[]> {
  const supabase = await createClient()

  let query = supabase
    .from('pt_sessions')
    .select(
      'id, branch_id, trainer_id, member_id, membership_id, scheduled_at, duration_minutes, status, notes, members(full_name, member_code), staff(full_name), memberships(plan_name, plan_type, sessions_remaining)'
    )
    .gte('scheduled_at', args.since)
    .order('scheduled_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(300)

  if (args.branchIds) query = query.in('branch_id', args.branchIds)
  if (args.trainerId) query = query.eq('trainer_id', args.trainerId)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as PtSessionListRow[]
}

/** Active staff who can take a PT session at these branches. */
export async function listPtTrainers(branchIds: string[] | null) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('staff')
    .select('id, full_name, role, branch_ids')
    .eq('status', 'active')
    .in('role', ['trainer', 'manager', 'owner'])
    .order('full_name')

  if (error) throw error
  return (data ?? []).filter(
    (row) =>
      row.role === 'owner' ||
      !branchIds ||
      (row.branch_ids ?? []).some((id) => branchIds.includes(id))
  )
}

export async function findMemberByCode(code: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('members')
    .select('id, full_name')
    .eq('member_code', code.trim())
    .maybeSingle()
  if (error) throw error
  return data
}

export async function bookPtSession(args: {
  memberId: string
  trainerId: string
  scheduledAt: string
  durationMinutes: number
  notes?: string | null
}) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('book_pt_session', {
    p_member_id: args.memberId,
    p_trainer_id: args.trainerId,
    p_scheduled_at: args.scheduledAt,
    p_duration_minutes: args.durationMinutes,
    p_notes: args.notes ?? undefined,
  })
  if (error) throw error
}

export async function completePtSession(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('complete_pt_session', { p_pt_session_id: id })
  if (error) throw error
}

export async function cancelPtSession(id: string, reason?: string) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_pt_session', {
    p_pt_session_id: id,
    p_reason: reason ?? undefined,
  })
  if (error) throw error
}
