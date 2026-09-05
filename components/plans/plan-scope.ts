import type { StaffRole } from '@/lib/roles'

/**
 * Whether a staff member may create or edit a plan sold at these branches.
 * Owners may scope a plan anywhere, including org-wide (empty list). Managers
 * are limited to a non-empty subset of their own branches -- the same rule the
 * RLS policies enforce, restated here so the form and the action can refuse
 * with a readable message instead of an opaque policy rejection.
 */
export function canScopePlan(
  role: StaffRole,
  actorBranchIds: string[],
  planBranchIds: string[]
) {
  if (role === 'owner') return true
  if (role !== 'manager') return false
  return (
    planBranchIds.length > 0 &&
    planBranchIds.every((id) => actorBranchIds.includes(id))
  )
}
