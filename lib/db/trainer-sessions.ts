import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type ClassBookingStatus = Database['public']['Enums']['class_booking_status']

export type AttendanceSession = {
  id: string
  starts_at: string
  ends_at: string
  capacity: number
  trainer_id: string | null
  classes: { name: string; room: string | null } | null
  class_bookings: {
    id: string
    status: ClassBookingStatus
    members: { full_name: string; member_code: string } | null
  }[]
}

/**
 * Class sessions that have started within the last `lookbackDays`, newest
 * first, with their seat-holding bookings. `trainerId` narrows to one trainer
 * (what a trainer sees); managers and owners pass null and see their branches.
 */
export async function listSessionsToMark(args: {
  branchIds: string[] | null
  trainerId: string | null
  lookbackDays?: number
}): Promise<AttendanceSession[]> {
  const supabase = await createClient()
  const since = new Date(Date.now() - (args.lookbackDays ?? 3) * 86_400_000).toISOString()

  let query = supabase
    .from('class_sessions')
    .select(
      'id, starts_at, ends_at, capacity, trainer_id, classes(name, room), class_bookings(id, status, members(full_name, member_code))'
    )
    .eq('status', 'scheduled')
    .gte('starts_at', since)
    .lte('starts_at', new Date().toISOString())
    .in('class_bookings.status', ['booked', 'attended', 'no_show'])
    .order('starts_at', { ascending: false })
    .order('id', { ascending: true })

  if (args.trainerId) query = query.eq('trainer_id', args.trainerId)
  if (args.branchIds) query = query.in('branch_id', args.branchIds)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as AttendanceSession[]
}

export async function markSessionAttendance(bookingId: string, attended: boolean) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('mark_session_attendance', {
    p_booking_id: bookingId,
    p_attended: attended,
  })
  if (error) throw error
}
