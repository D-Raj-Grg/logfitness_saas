'use client'

import { useActionState, useState } from 'react'

import { setFeeActive, type FeeFormState } from '@/app/(app)/settings/fees/actions'
import { FeeDialog } from '@/components/settings/fee-dialog'
import type { FeePlan } from '@/components/settings/fee-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { FeeRow } from '@/lib/db/fees'
import { formatMoney } from '@/lib/format'
import { FEE_CHARGE_RULE_LABELS } from '@/lib/validation/fees'

function ActiveToggle({ fee }: { fee: FeeRow }) {
  const [state, formAction, pending] = useActionState<FeeFormState, FormData>(
    setFeeActive,
    {}
  )

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="feeId" value={fee.id} />
      <input type="hidden" name="isActive" value={fee.is_active ? 'false' : 'true'} />
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {fee.is_active ? 'Deactivate' : 'Activate'}
      </Button>
    </form>
  )
}

/** "All plans", or the plan names, or a count once the list gets long. */
function appliesTo(fee: FeeRow, planNames: Record<string, string>) {
  if (fee.all_plans) return 'All plans'
  const names = fee.plan_ids.map((id) => planNames[id] ?? 'Unknown plan')
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

export function FeesTable({ rows, plans }: { rows: FeeRow[]; plans: FeePlan[] }) {
  const [editing, setEditing] = useState<FeeRow | null>(null)
  const planNames = Object.fromEntries(plans.map((plan) => [plan.id, plan.name]))

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No fees yet. Add a registration fee, a card fee, or anything else you charge on
        top of a plan.
      </p>
    )
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>When</TableHead>
            <TableHead>Applies to</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((fee) => (
            <TableRow key={fee.id}>
              <TableCell className="font-medium">{fee.name}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(fee.amount_paisa)}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {FEE_CHARGE_RULE_LABELS[fee.charge_rule]}
              </TableCell>
              <TableCell className="max-w-xs text-sm text-muted-foreground">
                {appliesTo(fee, planNames)}
              </TableCell>
              <TableCell>
                <Badge variant={fee.is_active ? 'default' : 'secondary'}>
                  {fee.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(fee)}
                >
                  Edit
                </Button>
                <ActiveToggle fee={fee} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <FeeDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        fee={editing ?? undefined}
        plans={plans}
      />
    </>
  )
}
