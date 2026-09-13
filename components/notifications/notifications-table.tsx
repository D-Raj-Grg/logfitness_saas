import { NotificationRowActions } from '@/components/notifications/notification-row-actions'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { NotificationMessageRow, NotificationStatus } from '@/lib/db/notifications'
import { NOTIFICATION_STATUS_SHORT } from '@/lib/notifications/labels'
import { formatDateTime } from '@/lib/format'

const STATUS_LABELS = NOTIFICATION_STATUS_SHORT

/**
 * Colour carries the meaning here, because the status column is scanned rather
 * than read. Green for arrived, blue for moving, amber for waiting, red only
 * for a real failure.
 *
 * `skipped` is not a failure and must not look like one -- it is the gym
 * choosing not to send, or a number nobody can deliver to. Reading it as red
 * would send someone hunting for a gateway problem that does not exist, so it
 * stays grey alongside `cancelled`.
 */
const STATUS_STYLES: Record<NotificationStatus, string> = {
  queued: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  sending: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  sent: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
  cancelled: 'border-border bg-muted text-muted-foreground',
  skipped: 'border-border bg-muted text-muted-foreground',
}

/** The dot repeats the status without relying on colour alone. */
const STATUS_DOTS: Record<NotificationStatus, string> = {
  queued: 'bg-amber-500',
  sending: 'bg-sky-500 animate-pulse',
  sent: 'bg-emerald-500',
  failed: 'bg-destructive',
  cancelled: 'bg-muted-foreground/40',
  skipped: 'bg-muted-foreground/40',
}

const EVENT_LABELS: Record<NotificationMessageRow['event'], string> = {
  renewal_reminder: 'Renewal',
  dues_reminder: 'Dues',
  birthday_greeting: 'Birthday',
  staff_invite: 'Staff invite',
  test_message: 'Test',
  custom_message: 'By hand',
  visitor_welcome: 'Visitor welcome',
  visitor_follow_up: 'Visitor follow-up',
}

const CHANNEL_LABELS: Record<NotificationMessageRow['channel'], string> = {
  sms: 'SMS',
  viber: 'Viber',
  email: 'Email',
}

export function NotificationsTable({
  rows,
  branchNames,
  staffNames,
  canAct,
}: {
  rows: NotificationMessageRow[]
  branchNames: Record<string, string>
  /** Who pressed Send, for the rows a person raised rather than a sweep. */
  staffNames: Record<string, string>
  /** Owner or the branch's manager. The desk reads the log and cannot resend. */
  canAct: boolean
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="font-medium">Nothing has been sent yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Reminders start going out once a gateway is set up in Settings. Until
          then nothing is queued and nothing is charged.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border">
      {/* Fixed layout is what keeps the message from spilling over Status. With
          the default auto layout a long body sets the column's intrinsic width
          and max-width on a cell is ignored, so the text ran under the badge. */}
      <Table className="table-fixed min-w-[64rem]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">When</TableHead>
            <TableHead className="w-44">To</TableHead>
            <TableHead className="w-32">Reason</TableHead>
            <TableHead>Message</TableHead>
            <TableHead className="w-40">Status</TableHead>
            <TableHead className="w-32 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap align-top text-sm text-muted-foreground">
                {formatDateTime(row.created_at)}
                {row.branch_id ? (
                  <div className="text-xs">{branchNames[row.branch_id] ?? '—'}</div>
                ) : null}
              </TableCell>
              <TableCell className="align-top">
                <div className="truncate font-medium">{row.to_address}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {CHANNEL_LABELS[row.channel]}
                  {row.provider ? ` · ${row.provider.replace(/_/g, ' ')}` : ''}
                </div>
              </TableCell>
              <TableCell className="align-top text-sm">
                {EVENT_LABELS[row.event]}
                {/* A sweep raised every row until manual sends landed. Naming
                    the sender is what makes "who texted this member" answerable. */}
                {row.created_by ? (
                  <div className="text-xs text-muted-foreground">
                    {staffNames[row.created_by] ?? 'Sent by hand'}
                  </div>
                ) : null}
              </TableCell>
              {/* TableCell is whitespace-nowrap by default, which is why the
                  clamp had nothing to wrap and the line ran to the edge. */}
              <TableCell className="align-top pr-6 text-sm whitespace-normal">
                {row.subject ? (
                  <div className="truncate font-medium">{row.subject}</div>
                ) : null}
                {/* Two lines is enough to recognise which wording went out; the
                    full text stays reachable on hover rather than pushing every
                    row tall. */}
                <div
                  className="line-clamp-2 break-words text-muted-foreground"
                  title={row.body}
                >
                  {row.body}
                </div>
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                <Badge
                  variant="outline"
                  className={`gap-1.5 whitespace-nowrap ${STATUS_STYLES[row.status]}`}
                >
                  <span
                    aria-hidden
                    className={`size-1.5 rounded-full ${STATUS_DOTS[row.status]}`}
                  />
                  {STATUS_LABELS[row.status]}
                </Badge>
                {row.last_error ? (
                  <div
                    className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground"
                    title={row.last_error}
                  >
                    {row.last_error}
                  </div>
                ) : null}
                {row.attempts > 1 ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {row.attempts} attempts
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="align-top text-right">
                {canAct ? (
                  <NotificationRowActions notificationId={row.id} status={row.status} />
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
