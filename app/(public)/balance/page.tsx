import type { Metadata } from 'next'

import { BalanceCard, CardLinkProblem } from '@/components/balance/balance-card'
import { parseCardToken } from '@/lib/cards/card-token'
import { getPublicBalance } from '@/lib/db/public-balance'

export const metadata: Metadata = {
  title: 'Membership balance',
  robots: { index: false },
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * The page a member lands on from the QR on their card:
 * /balance?org=<slug>&c=0004_k3x9q2mf. Nobody signs in; the URL is the whole
 * input. There is deliberately no "type your card number" box: the number is
 * printed on the card and easy to guess, so only the random token in the QR
 * opens a card.
 */
export default async function BalancePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const org = first(params.org)?.trim() ?? ''
  const token = parseCardToken(first(params.c))

  if (!org) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
          This link is missing the gym code. Scan the QR on your card again, or ask at the
          front desk.
        </p>
      </div>
    )
  }

  // No token, a mangled one, or an old ?card_no= link: nothing to look up.
  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <CardLinkProblem />
      </div>
    )
  }

  const balance = await getPublicBalance(org, token)

  return (
    <div className="flex flex-col gap-4">
      <BalanceCard org={org} token={token} balance={balance} />
    </div>
  )
}
