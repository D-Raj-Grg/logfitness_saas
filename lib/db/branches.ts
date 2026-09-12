import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'
import type { BranchInput } from '@/lib/validation/branches'

/**
 * Branches visible to the caller. RLS limits this to the caller's org, so no
 * org filter is applied -- or needed -- here.
 */
export const listBranches = cache(async function listBranches() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('branches')
    .select('id, name, status, address, phone')
    .order('name')

  if (error) throw error
  return data
})

export async function createBranch(orgId: string, input: BranchInput) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('branches')
    .insert({
      org_id: orgId,
      name: input.name,
      address: input.address || null,
      phone: input.phone || null,
      status: 'active',
    })
    .select('id')
    .single()

  if (error) throw error
  return data
}

export async function updateBranch(id: string, input: BranchInput) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('branches')
    .update({
      name: input.name,
      address: input.address || null,
      phone: input.phone || null,
    })
    .eq('id', id)

  if (error) throw error
}

/** Deactivating, never deleting: the branch keeps every row it owns. */
export async function setBranchStatus(id: string, status: 'active' | 'inactive') {
  const supabase = await createClient()

  const { error } = await supabase.from('branches').update({ status }).eq('id', id)

  if (error) throw error
}

// RLS is what actually stops a cross-org write here -- neither createBranch nor
// updateBranch filters on org_id, because the update policy already does, and
// restating it in the client would imply the policy is optional.
