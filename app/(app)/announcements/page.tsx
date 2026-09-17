import Link from 'next/link'

import { NewAnnouncementButton } from '@/components/announcements/announcement-composer'
import { AnnouncementsTable } from '@/components/announcements/announcements-table'
import { Pagination } from '@/components/app/pagination'
import { LiveRefresh } from '@/components/notifications/live-refresh'
import { requireRole } from '@/lib/auth'
import { listAnnouncements } from '@/lib/db/announcements'
import { listBranches } from '@/lib/db/branches'
import { listNotificationProviders } from '@/lib/db/notifications'
import { announcementListQuerySchema } from '@/lib/validation/announcements'

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  // Owners and managers. A broadcast spends the chain's SMS credit on hundreds
  // of messages at once, which is a decision one step above the desk --
  // `send_announcement` refuses the other two roles as well.
  const staff = await requireRole('owner', 'manager')
  const raw = await searchParams

  const parsed = announcementListQuerySchema.safeParse({
    page: first(raw.page),
    pageSize: first(raw.pageSize),
  })
  const query = parsed.success ? parsed.data : announcementListQuerySchema.parse({})

  const [result, branches, providers] = await Promise.all([
    listAnnouncements({ page: query.page, pageSize: query.pageSize }),
    listBranches(),
    // Managers cannot read gateway rows -- RLS is owner-only -- so this comes
    // back empty for them, and so does the banner.
    staff.role === 'owner' ? listNotificationProviders() : Promise.resolve([]),
  ])

  const hasGateway = providers.some((provider) => provider.is_active)

  // How many messages on this page are still in flight. Nothing moving means
  // no polling at all, which is the common case a day after a closure notice.
  const pendingCount = result.rows.reduce((total, row) => total + (row.queued ?? 0), 0)

  return (
    <div className="flex flex-col gap-6">
      {/* A send is still moving for a minute or so after the button. The same
          poll the delivery log uses keeps the counts climbing without anybody
          reaching for refresh. */}
      <LiveRefresh pending={pendingCount} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Announcements</h1>
          <p className="text-sm text-muted-foreground">
            Tell every member and walk-in one thing at once — a closure, a holiday, a
            change of hours.
          </p>
        </div>
        <NewAnnouncementButton
          branches={branches.map((branch) => ({ id: branch.id, name: branch.name }))}
        />
      </div>

      {staff.role === 'owner' && !hasGateway ? (
        <div className="rounded-lg border border-dashed p-4 text-sm">
          <p className="font-medium">No gateway is set up yet</p>
          <p className="mt-1 text-muted-foreground">
            An announcement can be written and queued, but nothing leaves the building
            until an SMS account is connected.{' '}
            <Link href="/settings/notifications" className="underline underline-offset-4">
              Connect one
            </Link>
            .
          </p>
        </div>
      ) : null}

      <AnnouncementsTable rows={result.rows} />

      <Pagination
        basePath="/announcements"
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        params={{}}
      />
    </div>
  )
}
