import type { Metadata } from 'next'

import { BalanceCard } from '@/components/balance/balance-card'
import { BalanceLookupForm } from '@/components/balance/balance-lookup-form'
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
 * /balance?org=<slug>&card_no=0004. Nobody signs in; the URL is the whole
 * input, and the lookup is a GET so the result stays shareable.
 */
export default async function BalancePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const org = first(params.org)?.trim() ?? ''
  const cardNo = first(params.card_no)?.trim() ?? ''

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

  const balance = cardNo ? await getPublicBalance(org, cardNo) : null

  return (
    <div className="flex flex-col gap-4">
      {balance ? <BalanceCard org={org} balance={balance} /> : null}
      <BalanceLookupForm org={org} cardNo={cardNo} hasResult={balance !== null} />
    </div>
  )
}
