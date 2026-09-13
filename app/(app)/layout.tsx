import { Suspense } from 'react'

import { AppSidebar } from '@/components/app/app-sidebar'
import { BranchSwitcher } from '@/components/app/branch-switcher'
import { Separator } from '@/components/ui/separator'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { requireStaff, type CurrentStaff } from '@/lib/auth'
import { resolveBranchScope } from '@/lib/scope'

/**
 * The switcher's options cost a branches query, and the shell has nothing to do
 * with the answer. Resolving it here instead of in the layout body keeps the
 * sidebar, header and page boundary in the static shell -- they flush while
 * this is still in flight.
 */
async function BranchSwitcherSlot({ staff }: { staff: CurrentStaff }) {
  // The layout has no searchParams of its own -- the switcher's current
  // value comes from the client's own useSearchParams. This only supplies
  // the options.
  const scope = await resolveBranchScope({}, staff)
  return <BranchSwitcher scope={scope} />
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Stays awaited: this is the auth gate, and it may redirect. Once streaming
  // has begun the response is already 200 and a clean redirect is no longer
  // available, so the decision has to happen before the first flush.
  // getCurrentStaff is React.cache'd, so the pages below reuse this result.
  const staff = await requireStaff()

  return (
    <SidebarProvider>
      <AppSidebar staff={staff} />
      <SidebarInset>
        <header className="flex h-14 min-w-0 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium">{staff.orgName}</span>
          <Suspense fallback={<Skeleton className="h-8 w-40 rounded-lg" />}>
            <BranchSwitcherSlot staff={staff} />
          </Suspense>
        </header>
        {/* min-w-0 all the way down: the inset is a flex child, and without
            it any wide child -- a table that scrolls inside its own box, a
            long unbroken string -- sets the minimum width of the whole page
            and scrolls the layout sideways on a phone. */}
        <main className="flex min-w-0 flex-1 flex-col gap-4 p-4">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
