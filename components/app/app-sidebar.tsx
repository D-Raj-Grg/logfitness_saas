'use client'

import { Dumbbell } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { navItemsForRole, type NavItem } from '@/components/app/nav-items'
import { UserMenu } from '@/components/app/user-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import type { CurrentStaff } from '@/lib/roles'

/** Live counts the layout fetches; a missing or zero key shows no badge. */
export type SidebarBadges = Partial<Record<NonNullable<NavItem['badgeKey']>, number>>

const BADGE_NOUNS = {
  renewalRequests: 'pending renewal request',
} as const

export function AppSidebar({
  staff,
  badges,
}: {
  staff: CurrentStaff
  badges?: SidebarBadges
}) {
  const pathname = usePathname()
  const items = navItemsForRole(staff.role)
  const { isMobile, setOpenMobile } = useSidebar()

  /**
   * On a phone the sidebar is a sheet over the page, so following a link
   * leaves it covering the screen someone just asked for. Closing on tap is
   * what makes it behave like navigation rather than a stuck overlay. On
   * desktop the sidebar is permanent and must stay put.
   */
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false)
  }

  const legalName = staff.orgLegalName?.trim()
  const subtitle = legalName && legalName !== staff.orgName ? legalName : null

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              onClick={closeOnMobile}
              render={<Link href="/" />}
            >
              <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Dumbbell className="size-4" />
              </span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">{staff.orgName}</span>
                {/* The registered name, and only when it says something the
                    line above does not. A gym that never filled it in gets one
                    line rather than the same name twice. */}
                {subtitle ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {subtitle}
                  </span>
                ) : null}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active =
                  item.href === '/'
                    ? pathname === '/'
                    : pathname.startsWith(item.href)

                const count = item.badgeKey ? (badges?.[item.badgeKey] ?? 0) : 0

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.title}
                      onClick={closeOnMobile}
                      render={<Link href={item.href} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                    {count > 0 && item.badgeKey ? (
                      <SidebarMenuBadge
                        className="bg-primary text-primary-foreground"
                        aria-label={`${count} ${BADGE_NOUNS[item.badgeKey]}${count === 1 ? '' : 's'}`}
                      >
                        {count > 9 ? '9+' : count}
                      </SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <UserMenu staff={staff} />
      </SidebarFooter>
    </Sidebar>
  )
}
