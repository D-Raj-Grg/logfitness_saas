'use client'

import { useState } from 'react'

import { FeeForm, type FeePlan } from '@/components/settings/fee-form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { FeeRow } from '@/lib/db/fees'

export function FeeDialog({
  open,
  onOpenChange,
  fee,
  plans,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  fee?: FeeRow
  plans: FeePlan[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{fee ? `Edit ${fee.name}` : 'New fee'}</DialogTitle>
          <DialogDescription>
            {fee
              ? 'Changes apply to new sales only. Invoices already written keep the fee they charged.'
              : 'A charge on top of the plan price, such as registration or a member card.'}
          </DialogDescription>
        </DialogHeader>
        {/* Keyed so a reopened dialog starts from the fee, not stale state. */}
        {open ? (
          <FeeForm
            key={fee?.id ?? 'new'}
            fee={fee}
            plans={plans}
            onSaved={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function NewFeeButton({ plans }: { plans: FeePlan[] }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)}>New fee</Button>
      <FeeDialog open={open} onOpenChange={setOpen} plans={plans} />
    </>
  )
}
