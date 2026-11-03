import { ORG_LOGO_BUCKET } from '@/lib/org-logo'
import { createClient } from '@/lib/supabase/server'
import type { Database, Json } from '@/lib/types/database'

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

/**
 * Does this gym record check-OUT? Off unless the owner turned it on: a gym with
 * no exit reader never records one, so showing the Check out button, the "In the
 * gym now" list and an Out column would only show a roster that never empties.
 * No stored value means off. Staff clock-out (their own shifts) is a separate
 * feature and is not affected.
 */
export async function getTrackCheckOut(orgId: string): Promise<boolean> {
  const org = await getOrgProfile(orgId)
  const bag = org?.settings
  return (
    typeof bag === 'object' &&
    bag !== null &&
    !Array.isArray(bag) &&
    (bag as Record<string, unknown>).track_check_out === true
  )
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

/**
 * Merges one allow-listed key into orgs.settings. The RPC is owner-only and
 * validates key and value; a direct orgs update would replace the whole bag.
 */
export async function setOrgSetting(key: string, value: Json) {
  const supabase = await createClient()

  const { error } = await supabase.rpc('set_org_setting', {
    _key: key,
    _value: value,
  })

  if (error) throw error
}
