'use client'

import { useState } from 'react'

import { PlanForm, type PlanBranch } from '@/components/plans/plan-form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { PlanRow } from '@/lib/db/plans'
import type { StaffRole } from '@/lib/roles'

export type PlanFormContext = {
  branches: PlanBranch[]
  actorRole: StaffRole
  actorBranchIds: string[]
}

export function PlanDialog({
  open,
  onOpenChange,
  plan,
  context,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan?: PlanRow
  context: PlanFormContext
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{plan ? `Edit ${plan.name}` : 'New plan'}</DialogTitle>
          <DialogDescription>
            {plan
              ? 'Changes apply to new sales only. Existing memberships keep their price.'
              : 'What you sell at the front desk. Prices are in rupees.'}
          </DialogDescription>
        </DialogHeader>
        {/* Keyed so a reopened dialog starts from the plan, not stale state. */}
        {open ? (
          <PlanForm
            key={plan?.id ?? 'new'}
            plan={plan}
            {...context}
            onSaved={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function NewPlanButton({ context }: { context: PlanFormContext }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)}>New plan</Button>
      <PlanDialog open={open} onOpenChange={setOpen} context={context} />
    </>
  )
}
