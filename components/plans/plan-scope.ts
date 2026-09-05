import type { StaffRole } from '@/lib/roles'

/**
 * Whether a staff member may create or edit a plan sold at these branches.
 * Owners may scope a plan anywhere, including org-wide (empty list). Everyone
 * else -- managers and, since the desk sells plans it sometimes has to add
 * first, the front desk -- is limited to a non-empty subset of their own
 * branches. That is the same rule the RLS policies enforce, restated here so
 * the form and the action can refuse with a readable message instead of an
 * opaque policy rejection.
 */
export function canScopePlan(
  role: StaffRole,
  actorBranchIds: string[],
  planBranchIds: string[]
) {
  if (role === 'owner') return true
  if (role !== 'manager' && role !== 'front_desk') return false
  return (
    planBranchIds.length > 0 &&
    planBranchIds.every((id) => actorBranchIds.includes(id))
  )
}
