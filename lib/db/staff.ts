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
