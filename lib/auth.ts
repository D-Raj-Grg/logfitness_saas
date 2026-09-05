import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import type { CurrentStaff, StaffRole } from '@/lib/roles'
import { createClient } from '@/lib/supabase/server'

export type { CurrentStaff, StaffRole }

export const CLAIMS_REFRESH_COOKIE = 'lg_claims_refreshed'

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
 * For pages that require a staff context.
 *
 * An account with no staff row is sent to /auth/link, which claims a pending
 * invitation if one exists and otherwise forwards to onboarding. That step is a
 * Route Handler on purpose: linking only takes effect once the session is
 * refreshed, and a Server Component cannot persist the refreshed cookies.
 */
export async function requireStaff(): Promise<CurrentStaff> {
  const staff = await getCurrentStaff()

  if (!staff) {
    redirect('/auth/link')
  }

  // The staff row exists but the access token predates it, so it carries no
  // tenant claims and every RLS read would come back empty. Send the request
  // through /auth/link, which can refresh the session and persist the cookies.
  if (!(await hasTenantClaims()) && !(await claimsRefreshWasAttempted())) {
    redirect('/auth/link')
  }

  return staff
}

async function hasTenantClaims(): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  return Boolean(data?.claims?.org_id)
}

/**
 * Breaks the redirect loop that would otherwise form if a refreshed token still
 * arrives without claims -- most likely because the access token hook is not
 * enabled on the project. The page then renders in its empty state instead of
 * bouncing forever.
 */
async function claimsRefreshWasAttempted(): Promise<boolean> {
  const cookieStore = await cookies()
  return cookieStore.get(CLAIMS_REFRESH_COOKIE)?.value === '1'
}



export async function requireRole(...roles: StaffRole[]): Promise<CurrentStaff> {
  const staff = await requireStaff()

  if (!roles.includes(staff.role)) {
    redirect('/')
  }

  return staff
}
