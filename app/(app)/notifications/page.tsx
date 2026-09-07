import Link from 'next/link'

import { Pagination } from '@/components/app/pagination'
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_STATUSES,
  NotificationFilters,
} from '@/components/notifications/notification-filters'
import { NotificationsTable } from '@/components/notifications/notifications-table'
import { Badge } from '@/components/ui/badge'
import { requireRole } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'
import {
  listNotificationProviders,
  listNotifications,
  notificationStatusCounts,
} from '@/lib/db/notifications'
import { resolveBranchScope } from '@/lib/scope'
import { notificationListQuerySchema } from '@/lib/validation/notifications'

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

const SUMMARY_STATUSES = ['sent', 'queued', 'failed', 'skipped'] as const

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  // Owners and managers. The desk sells the renewal; it does not audit whether
  // the chain's SMS credits are running out.
  const staff = await requireRole('owner', 'manager')
  const raw = await searchParams

  const scope = await resolveBranchScope(raw, staff)

  const parsed = notificationListQuerySchema.safeParse({
    status: first(raw.status),
    event: first(raw.event),
    channel: first(raw.channel),
    q: first(raw.q),
    page: first(raw.page),
    pageSize: first(raw.pageSize),
  })
  const query = parsed.success ? parsed.data : notificationListQuerySchema.parse({})

  const [result, counts, branches, providers] = await Promise.all([
    listNotifications({
      branchIds: scope.branchIds,
      status: query.status === 'all' ? undefined : query.status,
      event: query.event === 'all' ? undefined : query.event,
      channel: query.channel === 'all' ? undefined : query.channel,
      q: query.q,
      page: query.page,
      pageSize: query.pageSize,
    }),
    notificationStatusCounts(scope.branchIds, SUMMARY_STATUSES),
    listBranches(),
    // Managers cannot read gateway rows -- RLS is owner-only -- so this comes
    // back empty for them, and the "set one up" banner is owner-only too.
    staff.role === 'owner' ? listNotificationProviders() : Promise.resolve([]),
  ])

  const branchNames = Object.fromEntries(branches.map((branch) => [branch.id, branch.name]))
  const hasGateway = providers.some((provider) => provider.is_active)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Every reminder the gym has sent, and what the gateway said back.
          </p>
        </div>
        {staff.role === 'owner' ? (
          <Link
            href="/settings/notifications"
            className="text-sm font-medium underline underline-offset-4"
          >
            Gateway, reminders and wording
          </Link>
        ) : null}
      </div>

      {staff.role === 'owner' && !hasGateway ? (
        <div className="rounded-lg border border-dashed p-4 text-sm">
          <p className="font-medium">No gateway is set up yet</p>
          <p className="mt-1 text-muted-foreground">
            Reminders are worked out every night but nothing is queued and nothing
            is charged until an SMS account is connected.{' '}
            <Link href="/settings/notifications" className="underline underline-offset-4">
              Connect one
            </Link>
            .
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {SUMMARY_STATUSES.map((status) => (
          <Badge key={status} variant="outline">
            {NOTIFICATION_STATUSES[status]}: {counts[status] ?? 0}
          </Badge>
        ))}
      </div>

      <NotificationFilters
        status={query.status as keyof typeof NOTIFICATION_STATUSES}
        event={query.event as keyof typeof NOTIFICATION_EVENTS}
        channel={query.channel as keyof typeof NOTIFICATION_CHANNELS}
        q={query.q}
      />

      <NotificationsTable
        rows={result.rows}
        branchNames={branchNames}
        canAct={staff.role === 'owner' || staff.role === 'manager'}
      />

      <Pagination
        basePath="/notifications"
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        params={{
          status: query.status === 'all' ? undefined : query.status,
          event: query.event === 'all' ? undefined : query.event,
          channel: query.channel === 'all' ? undefined : query.channel,
          q: query.q || undefined,
          branch: first(raw.branch),
          pageSize: first(raw.pageSize),
        }}
      />
    </div>
  )
}
