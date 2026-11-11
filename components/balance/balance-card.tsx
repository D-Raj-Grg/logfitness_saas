import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RenewRequestForm } from '@/components/balance/renew-request-form'
import type { BalanceStatus, PublicBalance } from '@/lib/db/public-balance'
import { formatDate } from '@/lib/format'

const STATUS_LABEL: Record<BalanceStatus, string> = {
  active: 'Active',
  expiring: 'Expiring soon',
  expired: 'Expired',
  frozen: 'On hold',
  upcoming: 'Starts soon',
  none: 'No membership',
  left: 'Left',
}

function statusVariant(status: BalanceStatus): 'default' | 'outline' | 'destructive' | 'secondary' {
  if (status === 'active') return 'default'
  if (status === 'expiring' || status === 'upcoming') return 'outline'
  if (status === 'frozen' || status === 'none') return 'secondary'
  return 'destructive'
}

/** "12 days left" / "Last day today" / "Expired 3 days ago" / "Starts in 5 days". */
function daysLine(status: BalanceStatus, daysLeft: number | null): string | null {
  if (daysLeft === null) return null
  if (status === 'upcoming') {
    return daysLeft === 1 ? 'Starts tomorrow' : `Starts in ${daysLeft} days`
  }
  if (status === 'frozen') return null
  if (daysLeft > 0) return daysLeft === 1 ? '1 day left' : `${daysLeft} days left`
  if (daysLeft === 0) return 'Last day today'
  const ago = -daysLeft
  return ago === 1 ? 'Expired yesterday' : `Expired ${ago} days ago`
}

/** Can this member sensibly ask for a renewal? Not when they have already asked, or have left. */
function canRequest(status: BalanceStatus): boolean {
  return status !== 'left' && status !== 'upcoming'
}

export function BalanceCard({
  org,
  token,
  balance,
}: {
  org: string
  /** The card's link token, carried into the renewal form so it can name the card. */
  token: string
  balance: PublicBalance
}) {
  if (balance.result === 'org_not_found') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Gym not found</CardTitle>
          <CardDescription>
            This link does not point at a gym we know. Scan the QR on your card again, or ask
            at the front desk.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (balance.result === 'card_not_found') {
    return <CardLinkProblem />
  }

  if (balance.result === 'card_unassigned') {
    return (
      <Card>
        <CardHeader>
          <p className="font-mono text-xs tracking-widest text-muted-foreground">
            NO. {balance.card_no}
          </p>
          <CardTitle>Not assigned yet</CardTitle>
          <CardDescription>
            This card isn&apos;t assigned to a member yet — ask at the front desk.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const days = daysLine(balance.status, balance.days_left)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="font-mono text-xs tracking-widest text-muted-foreground">
              NO. {balance.card_no}
            </p>
            <CardTitle className="text-xl">{balance.name_masked}</CardTitle>
          </div>
          <Badge variant={statusVariant(balance.status)}>{STATUS_LABEL[balance.status]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Plan</dt>
          <dd>{balance.plan_name ?? '—'}</dd>
          {days ? (
            <>
              <dt className="text-muted-foreground">Time</dt>
              <dd className="font-medium">{days}</dd>
            </>
          ) : null}
          {balance.ends_on ? (
            <>
              <dt className="text-muted-foreground">Ends</dt>
              <dd>{formatDate(balance.ends_on)}</dd>
            </>
          ) : null}
        </dl>

        {balance.renewal_pending ? (
          <p
            role="status"
            className="rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground"
          >
            Renewal already requested — the front desk has it.
          </p>
        ) : canRequest(balance.status) ? (
          <RenewRequestForm org={org} token={token} />
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Shown when the link does not open a card: no token, a mistyped one, or one that was never issued. */
export function CardLinkProblem() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Scan the QR on your card</CardTitle>
        <CardDescription>
          Your balance opens from the QR code printed on your card. If scanning doesn&apos;t work,
          show your card at the front desk.
        </CardDescription>
      </CardHeader>
    </Card>
  )
}
