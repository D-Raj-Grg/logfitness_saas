import { AppSidebar } from '@/components/app/app-sidebar'
import { Separator } from '@/components/ui/separator'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { requireStaff } from '@/lib/auth'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const staff = await requireStaff()

  return (
    <SidebarProvider>
      <AppSidebar staff={staff} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium">{staff.orgName}</span>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
