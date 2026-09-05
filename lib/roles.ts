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
