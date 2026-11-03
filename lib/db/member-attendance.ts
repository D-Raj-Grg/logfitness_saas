import { createClient } from '@/lib/supabase/server'

/**
 * Every check-in a member has ever had, for the Attendance tab's total. A head
 * count: the rows themselves come from listAttendance a page at a time, so the
 * label can say the true number rather than "60" because that is where a list
 * stopped.
 */
export async function countAttendanceForMember(memberId: string) {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('attendance_detail')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', memberId)

  if (error) throw error
  return count ?? 0
}
