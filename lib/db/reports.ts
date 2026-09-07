import { createClient } from '@/lib/supabase/server'

/** One row per branch in scope, plus a totals row where branch_id is null. */
export async function orgSnapshot(branchIds?: string[] | null) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('org_snapshot', {
    p_branch_ids: branchIds ?? undefined,
  })

  if (error) throw error
  return data ?? []
}
