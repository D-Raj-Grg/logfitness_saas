'use client'

import { Dumbbell } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { navItemsForRole } from '@/components/app/nav-items'
import { UserMenu } from '@/components/app/user-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import type { CurrentStaff } from '@/lib/roles'

export function AppSidebar({ staff }: { staff: CurrentStaff }) {
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
                <span className="truncate text-xs text-muted-foreground">
                  Lord of Gyms
                </span>
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
