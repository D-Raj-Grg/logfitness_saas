import Link from 'next/link'

import { AssignCardDialog } from '@/components/cards/assign-card-dialog'
import { LinkUidDialog } from '@/components/cards/link-uid-dialog'
import { MemberPinControls } from '@/components/members/member-pin-controls'
import { StockStatusDialog } from '@/components/cards/stock-status-dialog'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cardLabel } from '@/lib/cards/card-no'
import type { CardStockEffectiveStatus, CardStockOverviewRow } from '@/lib/db/card-stock'
import type { UnassignedCardScan } from '@/lib/db/member-cards'
import { formatDate } from '@/lib/format'

const STATUS_BADGE: Record<
  CardStockEffectiveStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  assigned: { label: 'Assigned', variant: 'default' },
  free: { label: 'Free', variant: 'secondary' },
  lost: { label: 'Lost', variant: 'destructive' },
  retired: { label: 'Retired', variant: 'outline' },
}

/**
 * Every printed card the gym owns, by number. Server Component: the row
 * actions are the only client islands, one dialog per button.
 */
export function CardStockTable({
  rows,
  filtered,
  scans,
  canNumber,
}: {
  rows: CardStockOverviewRow[]
  /** True when a search term or filter is applied, so the empty copy fits. */
  filtered: boolean
  /** The enrollment inbox, for the Link chip dialogs. */
  scans: UnassignedCardScan[]
  /** Owner or manager: may number cards, so the empty state points there. */
  canNumber: boolean
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
        {filtered ? (
          <>
            <p className="text-sm font-medium">No cards match</p>
            <p className="text-sm text-muted-foreground">
              Try the number printed on the card, or clear the filters.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">No printed cards yet</p>
            <p className="text-sm text-muted-foreground">
              {canNumber
                ? 'Number the first batch above, then design and print them.'
                : 'A manager numbers each batch before the print shop runs it.'}
            </p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">No.</TableHead>
            <TableHead>Chip</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Holder</TableHead>
            <TableHead>Since</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const badge = STATUS_BADGE[row.effective_status]
            const linked = Boolean(row.card_uid)
            const assigned = row.effective_status === 'assigned'
            return (
              <TableRow key={row.id}>
                <TableCell className="font-mono font-semibold whitespace-nowrap">
                  {cardLabel(row.card_no)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {row.card_uid ? (
                    <span className="break-all">{row.card_uid}</span>
                  ) : (
                    <span className="font-sans text-muted-foreground">Not linked</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {row.status_reason && !assigned ? (
                      <span className="text-xs text-muted-foreground">{row.status_reason}</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  {row.holder_kind === 'member' && row.member_id ? (
                    <Link
                      href={`/members/${row.member_id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.holder_name ?? 'Member'}
                      {row.member_code ? (
                        <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                          {row.member_code}
                        </span>
                      ) : null}
                    </Link>
                  ) : row.holder_kind === 'staff' ? (
                    <span>Staff</span>
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                  {row.assigned_at ? formatDate(row.assigned_at) : '--'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    {row.holder_kind === 'member' && row.member_id ? (
                      <MemberPinControls
                        layout="compact"
                        memberId={row.member_id}
                        fullName={row.holder_name ?? 'this member'}
                      />
                    ) : null}
                    {!linked && row.status === 'free' ? (
                      <LinkUidDialog cardNo={row.card_no} scans={scans} />
                    ) : null}
                    {row.effective_status === 'free' && linked ? (
                      <AssignCardDialog cardNo={row.card_no} />
                    ) : null}
                    {row.effective_status === 'free' ? (
                      <>
                        <StockStatusDialog cardNo={row.card_no} status="lost" />
                        <StockStatusDialog cardNo={row.card_no} status="retired" />
                      </>
                    ) : null}
                    {row.effective_status === 'lost' || row.effective_status === 'retired' ? (
                      <StockStatusDialog cardNo={row.card_no} status="free" variant="outline" />
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
