import { Suspense } from 'react'

import { AppSidebar } from '@/components/app/app-sidebar'
import { BranchSwitcher } from '@/components/app/branch-switcher'
import { Separator } from '@/components/ui/separator'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { requireStaff } from '@/lib/auth'
import { resolveBranchScope } from '@/lib/scope'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const staff = await requireStaff()
  // The layout has no searchParams of its own -- the switcher's current
  // value comes from the client's own useSearchParams. This only supplies
  // the options.
  const scope = await resolveBranchScope({}, staff)

  return (
    <SidebarProvider>
      <AppSidebar staff={staff} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium">{staff.orgName}</span>
          <Suspense fallback={null}>
            <BranchSwitcher scope={scope} />
          </Suspense>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
