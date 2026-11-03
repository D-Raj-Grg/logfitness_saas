import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type StaffRow = Database['public']['Tables']['staff']['Row']

export async function listStaff() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('staff')
    .select('id, full_name, email, phone, role, branch_ids, status, accepted_at')
    .order('role')
    .order('full_name')

  if (error) throw error
  return data
}

/**
 * One staff member for their own screen. RLS lets every staff role read every
 * staff row in the org, so the caller must still decide who may look: the page
 * checks role and branch overlap. auth_user_id is deliberately not selected --
 * nothing on the screen needs the account id.
 */
export async function getStaff(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('staff')
    .select(
      'id, full_name, email, phone, role, branch_ids, status, invited_at, accepted_at, created_at'
    )
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data
}
