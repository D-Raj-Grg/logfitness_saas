import { createClient } from '@/lib/supabase/server'

/**
 * Branches visible to the caller. RLS limits this to the caller's org, so no
 * org filter is applied -- or needed -- here.
 */
export async function listBranches() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('branches')
    .select('id, name, status, address, phone')
    .order('name')

  if (error) throw error
  return data
}
