import { AnnouncementRowActions } from '@/components/announcements/announcement-row-actions'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { AnnouncementOverviewRow } from '@/lib/db/announcements'
import { formatDateTime } from '@/lib/format'

const AUDIENCE_LABELS = {
  members: 'Members',
  visitors: 'Visitors',
  both: 'Members and visitors',
} as const

/**
 * Delivery is a sentence, not a status. A broadcast is rarely in one state:
 * most of it has arrived, a few numbers were unusable, one failed. So the
 * column reads as counts, in the order the desk asks about them, and the badge
 * says only what stage the announcement as a whole is at.
 */
function deliveryLine(row: AnnouncementOverviewRow) {
  const parts: string[] = []
  if (row.sent) parts.push(`${row.sent} delivered`)
  if (row.queued) parts.push(`${row.queued} waiting`)
  if (row.failed) parts.push(`${row.failed} failed`)
  if (row.skipped) parts.push(`${row.skipped} not sent`)
  if (row.cancelled) parts.push(`${row.cancelled} stopped`)
  return parts.length ? parts.join(' · ') : 'Nothing queued'
}

export function AnnouncementsTable({ rows }: { rows: AnnouncementOverviewRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
        Nothing announced yet. A closure, a holiday, a change of hours — this is where
        you tell everybody at once.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56">Announcement</TableHead>
            <TableHead className="min-w-40">Audience</TableHead>
            <TableHead className="min-w-44">Delivery</TableHead>
            <TableHead className="min-w-40">When</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            // `state` is derived in the view from the outbox, not from what
            // was asked for: a scheduled announcement whose hour has passed
            // reads as sent, because it was.
            const state = row.state ?? 'sent'
            const scheduled = state === 'scheduled'
            const sending = state === 'sending'
            const cancelled = state === 'cancelled'

            return (
              <TableRow key={row.id} className="align-top">
                <TableCell className="min-w-0">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium break-words">{row.title}</span>
                    {/* The wording itself, because "what did we actually tell
                        them" is the question a month later. */}
                    <span className="text-xs text-muted-foreground break-words">
                      {row.body}
                    </span>
                    {row.created_by_name ? (
                      <span className="text-xs text-muted-foreground">
                        Sent by {row.created_by_name}
                      </span>
                    ) : null}
                  </div>
                </TableCell>

                <TableCell className="text-sm">
                  <div className="flex flex-col gap-1">
                    <span>{AUDIENCE_LABELS[row.audience ?? 'both']}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.branch_name ?? 'Every branch'}
                      {row.total ? ` · ${row.total} recipients` : ''}
                    </span>
                  </div>
                </TableCell>

                <TableCell className="text-sm tabular-nums">
                  <div className="flex flex-col gap-1">
                    <Badge
                      variant="outline"
                      className={
                        cancelled
                          ? 'border-border bg-muted text-muted-foreground'
                          : scheduled
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                            : sending
                              ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400'
                              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      }
                    >
                      {cancelled
                        ? 'Cancelled'
                        : scheduled
                          ? 'Scheduled'
                          : sending
                            ? 'Sending'
                            : 'Sent'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {deliveryLine(row)}
                    </span>
                  </div>
                </TableCell>

                <TableCell className="text-sm">
                  <div className="flex flex-col gap-1">
                    <span>{formatDateTime(row.scheduled_for ?? row.created_at!)}</span>
                    {scheduled ? (
                      <span className="text-xs text-muted-foreground">
                        Not sent yet
                      </span>
                    ) : null}
                  </div>
                </TableCell>

                <TableCell>
                  {/* Nothing left to stop once it has all gone, so the menu is
                      only offered while something can still be caught. */}
                  {!cancelled && (row.queued ?? 0) > 0 ? (
                    <AnnouncementRowActions id={row.id!} title={row.title!} />
                  ) : null}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
