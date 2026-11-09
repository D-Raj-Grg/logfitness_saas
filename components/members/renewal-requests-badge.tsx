import Link from 'next/link'
import { BellRing } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { countPendingRenewalRequests } from '@/lib/db/renewal-requests'

/**
 * "3 renewal requests" on the member list heading, the only way into
 * /members/requests. Nothing renders when no one is waiting, and a failed
 * count renders nothing too rather than taking the list down with it.
 */
export async function RenewalRequestsBadge({
  branchIds,
}: {
  branchIds?: string[] | null
}) {
  const count = await countPendingRenewalRequests(branchIds).catch(() => 0)
  if (count === 0) return null

  return (
    <Button variant="outline" size="sm" render={<Link href="/members/requests" />}>
      <BellRing />
      {count === 1 ? '1 renewal request' : `${count} renewal requests`}
    </Button>
  )
}
