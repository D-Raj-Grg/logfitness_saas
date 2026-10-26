import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type FeeRow = Database['public']['Tables']['fees']['Row']
export type FeeInsert = Database['public']['Tables']['fees']['Insert']
export type FeeUpdate = Database['public']['Tables']['fees']['Update']

/** The whole catalogue, active or not. RLS scopes it to the caller's org. */
export async function listFees() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('fees')
    .select('*')
    .order('is_active', { ascending: false })
    .order('sort_order')
    .order('name')

  if (error) throw error
  return data
}

/** Fees a sale can charge: active only. What the counter quotes from. */
export async function listActiveFees() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('fees')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
    .order('name')

  if (error) throw error
  return data
}

export async function getFee(feeId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('fees')
    .select('*')
    .eq('id', feeId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function insertFee(values: FeeInsert) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('fees')
    .insert(values)
    .select('id')
    .single()

  if (error) throw error
  return data
}

/** Owner-only; RLS is what enforces it, and updates zero rows for anyone else. */
export async function updateFee(feeId: string, values: FeeUpdate) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('fees')
    .update(values)
    .eq('id', feeId)
    .select('id')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Only an owner can change the fees.')
  }
}

/**
 * How this org charges, read on its own because the sale forms need it on every
 * plan lookup and have no business pulling the whole org row -- letterhead,
 * logo path and settings included -- for two values.
 *
 * `catalogueEnabled` is the switch (orgs.fee_catalogue_enabled). While it is
 * false the one fee is the plan's legacy joining fee, with `standardSignupFeePaisa`
 * as the reference a waiver is struck out against.
 */
export async function getFeeContext(orgId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('orgs')
    .select('fee_catalogue_enabled, standard_signup_fee_paisa')
    .eq('id', orgId)
    .maybeSingle()

  if (error) throw error
  return {
    catalogueEnabled: data?.fee_catalogue_enabled ?? false,
    standardSignupFeePaisa: data?.standard_signup_fee_paisa ?? 0,
  }
}
