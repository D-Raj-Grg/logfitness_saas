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
import { formatDateTime } from '@/lib/format'

const STATUS_LABELS: Record<NotificationStatus, string> = {
  queued: 'Waiting',
  sending: 'Going out',
  sent: 'Delivered',
  failed: 'Failed',
  cancelled: 'Cancelled',
  skipped: 'Not sent',
}

/**
 * `skipped` is not a failure and must not look like one -- it is the gym
 * choosing not to send, or a number nobody can deliver to. Reading it as red
 * would send someone hunting for a gateway problem that does not exist.
 */
const STATUS_VARIANTS: Record<NotificationStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  queued: 'outline',
  sending: 'outline',
  sent: 'secondary',
  failed: 'destructive',
  cancelled: 'secondary',
  skipped: 'secondary',
}

const EVENT_LABELS: Record<NotificationMessageRow['event'], string> = {
  renewal_reminder: 'Renewal',
  dues_reminder: 'Dues',
  birthday_greeting: 'Birthday',
  staff_invite: 'Staff invite',
  test_message: 'Test',
}

const CHANNEL_LABELS: Record<NotificationMessageRow['channel'], string> = {
  sms: 'SMS',
  viber: 'Viber',
  email: 'Email',
}

export function NotificationsTable({
  rows,
  branchNames,
  canAct,
}: {
  rows: NotificationMessageRow[]
  branchNames: Record<string, string>
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
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>To</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Message</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
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
                <div className="font-medium">{row.to_address}</div>
                <div className="text-xs text-muted-foreground">
                  {CHANNEL_LABELS[row.channel]}
                  {row.provider ? ` · ${row.provider.replace(/_/g, ' ')}` : ''}
                </div>
              </TableCell>
              <TableCell className="align-top text-sm">{EVENT_LABELS[row.event]}</TableCell>
              <TableCell className="max-w-md align-top text-sm">
                {row.subject ? <div className="font-medium">{row.subject}</div> : null}
                <div className="text-muted-foreground">{row.body}</div>
              </TableCell>
              <TableCell className="align-top">
                <Badge variant={STATUS_VARIANTS[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                {row.last_error ? (
                  <div className="mt-1 max-w-56 text-xs text-muted-foreground">{row.last_error}</div>
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
