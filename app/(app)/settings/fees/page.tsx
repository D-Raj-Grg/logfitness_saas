import Link from 'next/link'

import { NewFeeButton } from '@/components/settings/fee-dialog'
import { FeesTable } from '@/components/settings/fees-table'
import { requireRole } from '@/lib/auth'
import { getFeeContext, listFees } from '@/lib/db/fees'
import { listPlans } from '@/lib/db/plans'

export default async function FeesPage() {
  // Owner-only: pricing the gym is the owner's call, and RLS lets nobody else
  // write a fee.
  const staff = await requireRole('owner')

  const [fees, plans, feeContext] = await Promise.all([
    listFees(),
    listPlans(),
    getFeeContext(staff.orgId),
  ])

  const planOptions = plans.map(({ id, name, is_active }) => ({ id, name, is_active }))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/settings" className="text-sm text-muted-foreground underline">
            Settings
          </Link>
          <h1 className="text-2xl font-semibold">Fees</h1>
          <p className="text-sm text-muted-foreground">
            What you charge on top of a plan, such as registration or a member card.
            Each fee prints as its own line on the invoice.
          </p>
        </div>
        <NewFeeButton plans={planOptions} />
      </div>

      {feeContext.catalogueEnabled ? null : (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          These fees are not being charged yet. Until your gym is switched over, the
          joining fee on each plan is charged instead. You can set the fees up here
          ahead of time.
        </div>
      )}

      <FeesTable rows={fees} plans={planOptions} />
    </div>
  )
}
