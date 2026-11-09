import { RenewalRequestActions } from '@/components/members/renewal-request-actions'
import type { RenewalRequestRow } from '@/lib/db/renewal-requests'
import { formatDateTime } from '@/lib/format'
import { relativeTimeLabel } from '@/lib/relative-time'

const STATUS_LABEL: Record<RenewalRequestRow['status'], string> = {
  pending: 'Pending',
  done: 'Done',
  rejected: 'Rejected',
}

/**
 * The member's renewal requests from the balance page, above the history.
 * A pending one is a banner with Mark done / Reject -- the real answer is the
 * Renew button beside it, which closes the request by itself. With nothing
 * pending the past asks fold into one line; with no history at all, nothing.
 */
export function MemberRenewalRequests({
  requests,
  fullName,
  canManage,
}: {
  requests: RenewalRequestRow[]
  fullName: string
  canManage: boolean
}) {
  if (requests.length === 0) return null

  const pending = requests.find((row) => row.status === 'pending') ?? null
  const past = requests.filter((row) => row.status !== 'pending')

  return (
    <div className="flex flex-col gap-2">
      {pending ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">Asked to renew from the balance page</span>
            <span className="flex flex-wrap gap-x-2 text-muted-foreground">
              <span title={formatDateTime(pending.last_requested_at)}>
                {relativeTimeLabel(pending.last_requested_at) ??
                  formatDateTime(pending.last_requested_at)}
              </span>
              <span aria-hidden>·</span>
              <span>asked {pending.request_count}×</span>
              <span aria-hidden>·</span>
              <span>
                phone{' '}
                <span className="tabular-nums text-foreground">{pending.phone ?? '—'}</span>
              </span>
              {pending.note ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="break-words">
                    note <span className="text-foreground">{pending.note}</span>
                  </span>
                </>
              ) : null}
            </span>
          </div>
          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <RenewalRequestActions requestId={pending.id} fullName={fullName} />
            </div>
          ) : null}
        </div>
      ) : null}

      {past.length > 0 ? (
        <details className="rounded-lg border px-4 py-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Past requests ({past.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {past.map((row) => (
              <li key={row.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
                <span>{formatDateTime(row.last_requested_at)}</span>
                <span aria-hidden>·</span>
                <span className="text-foreground">{STATUS_LABEL[row.status]}</span>
                {row.handled_note ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="break-words">{row.handled_note}</span>
                  </>
                ) : null}
                {row.request_count > 1 ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>asked {row.request_count}×</span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
