import { ORG_LOGO_BUCKET } from '@/lib/org-logo'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type OrgRow = Database['public']['Tables']['orgs']['Row']
export type OrgUpdate = Database['public']['Tables']['orgs']['Update']

/** The fields a printed document reads off the org. */
export type OrgLetterhead = Pick<
  OrgRow,
  | 'name'
  | 'legal_name'
  | 'address'
  | 'phone'
  | 'email'
  | 'pan_no'
  | 'tax_note'
  | 'invoice_terms'
  | 'logo_path'
  | 'currency'
  | 'timezone'
>

/**
 * RLS already scopes this to the caller's org, but every lib/db function names
 * the row it wants, and being explicit keeps this honest if a service-role
 * client ever calls it.
 */
export async function getOrgProfile(orgId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('orgs')
    .select('*')
    .eq('id', orgId)
    .maybeSingle()

  if (error) throw error
  return data
}

/** Writes are owner-only; "owners update their own org" is what enforces it. */
export async function updateOrgProfile(orgId: string, values: OrgUpdate) {
  const supabase = await createClient()

  const { error } = await supabase.from('orgs').update(values).eq('id', orgId)

  if (error) throw error
}

export async function uploadOrgLogo(path: string, file: File) {
  const supabase = await createClient()

  const { error } = await supabase.storage
    .from(ORG_LOGO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (error) throw error
  return path
}

export async function removeOrgLogo(path: string) {
  const supabase = await createClient()
  const { error } = await supabase.storage.from(ORG_LOGO_BUCKET).remove([path])
  if (error) throw error
}
