import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type ClassSessionRow = Database['public']['Tables']['class_sessions']['Row']

export type TimetableSession = ClassSessionRow & {
  class_name: string
  room: string | null
}

export type SessionBooking = {
  id: string
  member_id: string
  status: Database['public']['Enums']['class_booking_status']
  booked_at: string
  member_name: string
  member_code: string | null
  phone: string | null
}

/** Sessions starting in [from, to). */
export async function listSessionsBetween(
  from: string,
  to: string,
  branchIds: string[] | null
): Promise<TimetableSession[]> {
  const supabase = await createClient()
  let query = supabase
    .from('class_sessions')
    .select('*, classes(name, room)')
    .gte('starts_at', from)
    .lt('starts_at', to)
    .order('starts_at')
  if (branchIds) query = query.in('branch_id', branchIds)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(({ classes, ...row }) => ({
    ...row,
    class_name: classes?.name ?? 'Class',
    room: classes?.room ?? null,
  }))
}

export async function getSession(sessionId: string): Promise<TimetableSession | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('class_sessions')
    .select('*, classes(name, room)')
    .eq('id', sessionId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const { classes, ...row } = data
  return { ...row, class_name: classes?.name ?? 'Class', room: classes?.room ?? null }
}

/** Live and historical bookings for one session, oldest first. */
export async function listSessionBookings(sessionId: string): Promise<SessionBooking[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('class_bookings')
    .select('id, member_id, status, booked_at, members(full_name, member_code, phone)')
    .eq('session_id', sessionId)
    .in('status', ['booked', 'waitlisted', 'attended', 'no_show'])
    .order('booked_at')
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    member_id: row.member_id,
    status: row.status,
    booked_at: row.booked_at,
    member_name: row.members?.full_name ?? 'Member',
    member_code: row.members?.member_code ?? null,
    phone: row.members?.phone ?? null,
  }))
}
