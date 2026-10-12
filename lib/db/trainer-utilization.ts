import { createClient } from '@/lib/supabase/server'

/** Per trainer and branch: class fill, attendance, and PT hours for a period. */
export async function trainerUtilization(args: {
  branchIds?: string[] | null
  from?: string
  to?: string
}) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('trainer_utilization', {
    p_branch_ids: args.branchIds ?? undefined,
    p_from: args.from ?? undefined,
    p_to: args.to ?? undefined,
  })
  if (error) throw error
  return data ?? []
}
