import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import type { RecurrenceSlot } from '@/lib/validation/classes'

export type ClassRow = Database['public']['Tables']['classes']['Row']

export function recurrenceOf(row: Pick<ClassRow, 'recurrence'>): RecurrenceSlot[] {
  return Array.isArray(row.recurrence) ? (row.recurrence as unknown as RecurrenceSlot[]) : []
}

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
