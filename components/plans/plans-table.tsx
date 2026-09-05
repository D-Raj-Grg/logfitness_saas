'use client'

import { useActionState, useState } from 'react'

import { setPlanActive, type PlanFormState } from '@/app/(app)/plans/actions'
import { PlanDialog, type PlanFormContext } from '@/components/plans/plan-dialog'
import { canScopePlan } from '@/components/plans/plan-scope'
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
import type { PlanRow } from '@/lib/db/plans'
import { formatMoney } from '@/lib/format'
import { PLAN_TYPE_LABELS } from '@/lib/members'

function planLength(plan: PlanRow) {
  if (plan.plan_type === 'time') return `${plan.duration_days} days`
  const sessions = `${plan.session_count} sessions`
  return plan.duration_days ? `${sessions}, valid ${plan.duration_days} days` : sessions
}

function ActiveToggle({ plan }: { plan: PlanRow }) {
  const [state, formAction, pending] = useActionState<PlanFormState, FormData>(
    setPlanActive,
    {}
  )

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="planId" value={plan.id} />
      <input type="hidden" name="isActive" value={plan.is_active ? 'false' : 'true'} />
      {state.error ? (
        <span className="text-xs text-destructive">{state.error}</span>
      ) : null}
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {plan.is_active ? 'Deactivate' : 'Activate'}
      </Button>
    </form>
  )
}

export function PlansTable({
  rows,
  branchNames,
  context,
}: {
  rows: PlanRow[]
  branchNames: Record<string, string>
  context: PlanFormContext
}) {
  const [editing, setEditing] = useState<PlanRow | null>(null)

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No plans yet. Add the first one to start selling memberships.
      </p>
    )
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Length</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Joining fee</TableHead>
            <TableHead>Branches</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((plan) => {
            const editable = canScopePlan(
              context.actorRole,
              context.actorBranchIds,
              plan.branch_ids
            )
            return (
              <TableRow key={plan.id}>
                <TableCell>
                  <span className="block font-medium">{plan.name}</span>
                  {plan.description ? (
                    <span className="block max-w-xs truncate text-xs text-muted-foreground">
                      {plan.description}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>{PLAN_TYPE_LABELS[plan.plan_type]}</TableCell>
                <TableCell>{planLength(plan)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(plan.price_paisa)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {plan.signup_fee_paisa ? formatMoney(plan.signup_fee_paisa) : '--'}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {plan.branch_ids.length === 0
                    ? 'All branches'
                    : plan.branch_ids.map((id) => branchNames[id] ?? 'Unknown').join(', ')}
                </TableCell>
                <TableCell>
                  <Badge variant={plan.is_active ? 'default' : 'secondary'}>
                    {plan.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {editable ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(plan)}
                      >
                        Edit
                      </Button>
                      <ActiveToggle plan={plan} />
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">Owner only</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <PlanDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        plan={editing ?? undefined}
        context={context}
      />
    </>
  )
}
