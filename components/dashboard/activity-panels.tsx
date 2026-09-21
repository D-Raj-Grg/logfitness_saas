import { ChartCard } from '@/components/dashboard/chart-card'
import {
  ActivityEmpty,
  ActivityList,
  ActivityRow,
} from '@/components/dashboard/activity-list'
import { recentPayments } from '@/lib/db/payments'
import { recentMemberships } from '@/lib/db/memberships'
import { listVisitors, type VisitorStatus } from '@/lib/db/visitors'
import { listMembers } from '@/lib/db/members'
import { formatDate, formatMoney, formatTime } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '@/lib/members'

/** Six rows is what fits beside a chart without the card growing a scrollbar. */
const ROWS = 6

/** The window the expiring panel calls on, matching the tile above it. */
const EXPIRING_DAYS = 7

type Named = { full_name: string | null } | null

/** Embeds come back as an object or null; a deleted member is still a payment. */
function nameOf(member: Named) {
  return member?.full_name?.trim() || 'Removed member'
}

export async function RecentPaymentsPanel({ branchIds }: { branchIds: string[] | null }) {
  const rows = await recentPayments({ branchIds, limit: ROWS })

  return (
    <ChartCard
      title="Recent payments"
      description={rows.length ? 'The last money in and out' : 'Nothing taken yet'}
      href="/payments"
      linkLabel="All payments"
    >
      {rows.length === 0 ? (
        <ActivityEmpty>No payments recorded yet.</ActivityEmpty>
      ) : (
        <ActivityList>
          {rows.map((row) => {
            const out = row.kind !== 'payment'
            return (
              <ActivityRow
                key={row.id}
                href={`/members/${row.member_id}`}
                title={nameOf(row.member as Named)}
                subtitle={`${PAYMENT_METHOD_LABELS[row.method]} · ${formatDate(row.paid_at)} ${formatTime(row.paid_at)}`}
                value={`${out ? '-' : ''}${formatMoney(row.amount_paisa)}`}
                note={row.kind === 'refund' ? 'refund' : row.kind === 'reversal' ? 'never received' : null}
                emphasis={out}
              />
            )
          })}
        </ActivityList>
      )}
    </ChartCard>
  )
}

export async function RecentMembershipsPanel({ branchIds }: { branchIds: string[] | null }) {
  const rows = await recentMemberships({ branchIds, limit: ROWS })

  return (
    <ChartCard
      title="New & renewed"
      description={rows.length ? 'The last memberships sold' : 'Nothing sold yet'}
      href="/members"
      linkLabel="All members"
    >
      {rows.length === 0 ? (
        <ActivityEmpty>No memberships sold yet.</ActivityEmpty>
      ) : (
        <ActivityList>
          {rows.map((row) => (
            <ActivityRow
              key={row.id}
              href={`/members/${row.member_id}`}
              title={nameOf(row.member as Named)}
              subtitle={`${row.previous_membership_id ? 'Renewed' : 'New'} · ${row.plan_name}`}
              value={formatMoney(row.price_paisa - row.discount_paisa)}
              note={row.end_date ? `to ${formatDate(row.end_date)}` : null}
            />
          ))}
        </ActivityList>
      )}
    </ChartCard>
  )
}

export async function RecentVisitorsPanel({ branchIds }: { branchIds: string[] | null }) {
  const { rows } = await listVisitors({ branchIds, page: 1, pageSize: ROWS })

  return (
    <ChartCard
      title="Recent visitors"
      description={rows.length ? 'Walk-ins and enquiries to follow up' : 'No visits logged'}
      href="/visitors"
      linkLabel="All visitors"
    >
      {rows.length === 0 ? (
        <ActivityEmpty>No visitors logged yet.</ActivityEmpty>
      ) : (
        <ActivityList>
          {rows.map((row) => (
            <ActivityRow
              key={row.id}
              href={`/visitors?q=${encodeURIComponent(row.phone ?? row.full_name)}`}
              title={row.full_name}
              subtitle={row.phone ?? 'No phone'}
              value={formatDate(row.visited_on)}
              note={VISITOR_NOTES[row.status]}
            />
          ))}
        </ActivityList>
      )}
    </ChartCard>
  )
}

/** The same words the visitors table uses, so the two never read differently. */
const VISITOR_NOTES: Record<VisitorStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  converted: 'Joined',
  lost: 'Not joining',
}

export async function ExpiringSoonPanel({ branchIds }: { branchIds: string[] | null }) {
  const { rows, total } = await listMembers(
    { q: '', status: 'expiring', sort: 'expiry', dir: 'asc', page: 1, pageSize: ROWS },
    branchIds
  )

  return (
    <ChartCard
      title="Expiring soon"
      description={
        total
          ? `${total} membership${total === 1 ? '' : 's'} ending within ${EXPIRING_DAYS} days`
          : `Nothing ends in the next ${EXPIRING_DAYS} days`
      }
      href="/members?status=expiring"
      linkLabel="Call list"
    >
      {rows.length === 0 ? (
        <ActivityEmpty>No memberships expiring this week.</ActivityEmpty>
      ) : (
        <ActivityList>
          {rows.map((row) => {
            const days = row.days_to_expiry ?? 0
            return (
              <ActivityRow
                key={row.id}
                href={`/members/${row.id}`}
                title={row.full_name}
                subtitle={row.phone}
                value={days <= 0 ? 'Today' : `${days}d`}
                note={row.membership_end_date ? formatDate(row.membership_end_date) : null}
                emphasis={days <= 2}
              />
            )
          })}
        </ActivityList>
      )}
    </ChartCard>
  )
}
