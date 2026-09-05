import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type PlanRow = Database['public']['Tables']['membership_plans']['Row']
export type PlanInsert = Database['public']['Tables']['membership_plans']['Insert']
export type PlanUpdate = Database['public']['Tables']['membership_plans']['Update']

/** The whole catalogue, active or not. RLS scopes it to the caller's org. */
export async function listPlans() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('membership_plans')
    .select('*')
    .order('is_active', { ascending: false })
    .order('sort_order')
    .order('name')

  if (error) throw error
  return data
}

/**
 * Plans on sale at one branch: active, and either org-wide or listing this
 * branch. This is the list the renew screen offers.
 */
export async function listPlansForBranch(branchId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('membership_plans')
    .select('*')
    .eq('is_active', true)
    .or(`branch_ids.eq.{},branch_ids.cs.{${branchId}}`)
    .order('sort_order')
    .order('name')

  if (error) throw error
  return data
}

export async function getPlan(planId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('membership_plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function insertPlan(values: PlanInsert) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('membership_plans')
    .insert(values)
    .select('id')
    .single()

  if (error) throw error
  return data
}

export async function updatePlan(planId: string, values: PlanUpdate) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('membership_plans')
    .update(values)
    .eq('id', planId)

  if (error) throw error
}
