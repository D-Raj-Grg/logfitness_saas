import { createClient } from '@/lib/supabase/server'
import { recurrenceOf, type ClassRow } from '@/lib/validation/classes'

export { recurrenceOf, type ClassRow }

/** Classes RLS lets the caller see; branchIds null = no extra filter. */
export async function listClasses(branchIds: string[] | null) {
  const supabase = await createClient()
  let query = supabase
    .from('classes')
    .select('*')
    .order('is_active', { ascending: false })
    .order('name')
  if (branchIds) query = query.in('branch_id', branchIds)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function listTrainers() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('staff')
    .select('id, full_name, branch_ids')
    .eq('role', 'trainer')
    .neq('status', 'inactive')
    .order('full_name')
  if (error) throw error
  return data
}
