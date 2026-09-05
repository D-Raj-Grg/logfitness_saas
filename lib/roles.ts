import type { Database } from '@/lib/types/database'

export type StaffRole = Database['public']['Enums']['staff_role']

export type CurrentStaff = {
  staffId: string
  orgId: string
  orgName: string
  fullName: string
  email: string
  role: StaffRole
  branchIds: string[]
}

export const ROLE_LABELS: Record<StaffRole, string> = {
  owner: 'Owner',
  manager: 'Branch manager',
  front_desk: 'Front desk',
  trainer: 'Trainer',
}

export const isOwner = (staff: CurrentStaff) => staff.role === 'owner'

export const canManageStaff = (staff: CurrentStaff) =>
  staff.role === 'owner' || staff.role === 'manager'

export const canManageBranches = (staff: CurrentStaff) => staff.role === 'owner'

export const canViewReports = (staff: CurrentStaff) =>
  staff.role === 'owner' || staff.role === 'manager'

/**
 * Roles a staff member may hand out. Owners appoint anyone; managers staff
 * their own floor but cannot create peers or superiors. The RLS insert policy
 * enforces the owner half of this; the manager-to-manager case is policy we
 * apply above the database, so both the form and the Server Action read it
 * from here rather than restating it.
 */
export function assignableRoles(actorRole: StaffRole): StaffRole[] {
  return actorRole === 'owner'
    ? ['owner', 'manager', 'front_desk', 'trainer']
    : actorRole === 'manager'
      ? ['front_desk', 'trainer']
      : []
}
