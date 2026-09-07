import {
  BarChart3,
  Bell,
  Building2,
  CreditCard,
  DoorOpen,
  LayoutDashboard,
  ScanLine,
  Settings,
  Tags,
  Users,
  UsersRound,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { StaffRole } from '@/lib/roles'

export type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  roles: StaffRole[]
}

const ALL_ROLES: StaffRole[] = ['owner', 'manager', 'front_desk', 'trainer']

/**
 * Navigation is filtered by role for clarity, not for security. Access is
 * enforced by RLS in the database -- hiding a link protects nothing on its own.
 */
export const NAV_ITEMS: NavItem[] = [
  { title: 'Dashboard', href: '/', icon: LayoutDashboard, roles: ALL_ROLES },
  { title: 'Check-in', href: '/check-in', icon: ScanLine, roles: ALL_ROLES },
  {
    title: 'Visitors',
    href: '/visitors',
    icon: DoorOpen,
    roles: ALL_ROLES,
  },
  {
    title: 'Members',
    href: '/members',
    icon: Users,
    roles: ['owner', 'manager', 'front_desk'],
  },
  {
    title: 'Payments',
    href: '/payments',
    icon: CreditCard,
    roles: ['owner', 'manager', 'front_desk'],
  },
  { title: 'Plans', href: '/plans', icon: Tags, roles: ['owner', 'manager'] },
  {
    title: 'Branches',
    href: '/branches',
    icon: Building2,
    roles: ['owner'],
  },
  {
    title: 'Staff',
    href: '/staff',
    icon: UsersRound,
    roles: ['owner', 'manager'],
  },
  {
    title: 'Reports',
    href: '/reports',
    icon: BarChart3,
    roles: ['owner', 'manager'],
  },
  {
    title: 'Notifications',
    href: '/notifications',
    icon: Bell,
    roles: ['owner', 'manager'],
  },
  { title: 'Settings', href: '/settings', icon: Settings, roles: ['owner'] },
]

export function navItemsForRole(role: StaffRole) {
  return NAV_ITEMS.filter((item) => item.roles.includes(role))
}
