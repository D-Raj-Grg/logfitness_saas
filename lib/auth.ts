import { redirect } from 'next/navigation'

import type { CurrentStaff, StaffRole } from '@/lib/roles'
import { createClient } from '@/lib/supabase/server'

export type { CurrentStaff, StaffRole }

/**
 * Resolves the signed-in user's staff record. Returns null when the account has
 * no active staff row -- a fresh signup that has not created an org yet, or an
 * invitation that has not been linked.
 *
 * Reads through the current_staff() RPC rather than the staff table, because at
 * this point the caller's token may not carry tenant claims yet.
 */
export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('current_staff')

  if (error || !data || data.length === 0) {
    return null
  }

  const row = data[0]

  return {
    staffId: row.staff_id,
    orgId: row.org_id,
    orgName: row.org_name,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    branchIds: row.branch_ids ?? [],
  }
}

/**
 * Same as getCurrentStaff, but first tries to claim a pending invitation. A
 * staff member invited by email signs up normally; this links that new auth
 * account to the staff row waiting for it, then refreshes the session so the
 * access token picks up the tenant claims RLS reads.
 */
export async function resolveStaffOrLinkInvite(): Promise<CurrentStaff | null> {
  const existing = await getCurrentStaff()
  if (existing) return existing

  const supabase = await createClient()
  const { error } = await supabase.rpc('link_staff_account')

  if (error) return null

  await supabase.auth.refreshSession()
  return getCurrentStaff()
}

/** For pages that require a staff context. Redirects when there is none. */
export async function requireStaff(): Promise<CurrentStaff> {
  const staff = await resolveStaffOrLinkInvite()

  if (!staff) {
    redirect('/onboarding')
  }

  return staff
}

export async function requireRole(...roles: StaffRole[]): Promise<CurrentStaff> {
  const staff = await requireStaff()

  if (!roles.includes(staff.role)) {
    redirect('/')
  }

  return staff
}
