import Link from 'next/link'

import { RenewalRequestActions } from '@/components/members/renewal-request-actions'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { requireRole } from '@/lib/auth'
import { cardLabel } from '@/lib/cards/card-no'
import { listPendingRenewalRequests, type PendingRenewalRequest } from '@/lib/db/renewal-requests'
import { formatDate, formatDateTime } from '@/lib/format'
import { relativeTimeLabel } from '@/lib/relative-time'
import { resolveBranchScope } from '@/lib/scope'

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

/** "expired 3 days ago" / "expires today" / "12 days left", from the view. */
function expiryLabel(days: number | null) {
  if (days === null) return null
  if (days < 0) return days === -1 ? 'expired yesterday' : `expired ${-days} days ago`
  if (days === 0) return 'expires today'
  return days === 1 ? '1 day left' : `${days} days left`
}

function RequestRow({ row }: { row: PendingRenewalRequest }) {
  const member = row.member
  const name = member?.full_name ?? 'Member not readable'
  const expiry = expiryLabel(member?.days_to_expiry ?? null)
  // The phone typed on the page only earns a line when it is not the one on
  // the record: digits only on both sides, so "+977 98..." equals "98...".
  const typedPhone = row.phone?.replace(/[^0-9]/g, '') ?? ''
  const recordPhone = member?.phone.replace(/[^0-9]/g, '') ?? ''
  const showTyped = Boolean(row.phone) && !(recordPhone && recordPhone.endsWith(typedPhone))

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <Link
            href={`/members/${row.member_id}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {name}
          </Link>
          <span className="flex flex-wrap gap-x-2 font-mono text-xs text-muted-foreground">
            {member ? <span>{member.member_code}</span> : null}
            {member?.card_no ? <span>{cardLabel(member.card_no)}</span> : null}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5 text-sm">
          {member ? <span className="tabular-nums">{member.phone}</span> : null}
          {showTyped ? (
            <span className="text-xs text-muted-foreground">
              Typed on the page: <span className="tabular-nums text-foreground">{row.phone}</span>
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="max-w-56 text-sm break-words whitespace-normal">
        {row.note ?? <span className="text-muted-foreground">--</span>}
      </TableCell>
      <TableCell className="text-sm whitespace-nowrap">
        <span className="block">asked {row.request_count}×</span>
        <span
          className="block text-xs text-muted-foreground"
          title={formatDateTime(row.last_requested_at)}
        >
          last {relativeTimeLabel(row.last_requested_at) ?? formatDate(row.last_requested_at)}
        </span>
      </TableCell>
      <TableCell className="text-sm">
        {member?.current_plan_name ? (
          <>
            <span className="block">{member.current_plan_name}</span>
            {expiry ? (
              <span
                className={
                  (member.days_to_expiry ?? 0) < 0
                    ? 'block text-xs text-destructive'
                    : 'block text-xs text-muted-foreground'
                }
              >
                {expiry}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-muted-foreground">No plan</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" render={<Link href={`/members/${row.member_id}?action=renew`} />}>
            Renew
          </Button>
          <RenewalRequestActions requestId={row.id} fullName={name} />
        </div>
      </TableCell>
    </TableRow>
  )
}

export default async function RenewalRequestsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const staff = await requireRole('owner', 'manager', 'front_desk')
  const raw = await searchParams
  // The header's branch switcher narrows this list the way it narrows the
  // member list; RLS already keeps it to branches the caller covers.
  const scope = await resolveBranchScope(raw, staff)
  const rows = await listPendingRenewalRequests(scope.branchIds)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Renewal requests</h1>
          <p className="text-sm text-muted-foreground">
            Members who tapped &ldquo;Request renewal&rdquo; on the card balance page. Renewing
            them at the desk closes the request by itself.
          </p>
        </div>
        <Button variant="outline" size="sm" render={<Link href="/members" />}>
          Back to members
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No one is waiting.</p>
          <p className="text-sm text-muted-foreground">
            New requests from the balance page show up here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Asked</TableHead>
                <TableHead>Membership</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <RequestRow key={row.id} row={row} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
