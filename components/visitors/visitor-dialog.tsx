'use client'

import { useState } from 'react'

import {
  VisitorForm,
  type VisitorBranch,
  type VisitorPlan,
} from '@/components/visitors/visitor-form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type VisitorFormContext = {
  branches: VisitorBranch[]
  plans: VisitorPlan[]
  defaultBranchId?: string
  today: string
}

export function NewVisitorButton({ context }: { context: VisitorFormContext }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)}>Log a visitor</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Log a visitor</DialogTitle>
            <DialogDescription>
              A name and a mobile number is enough. Everything else is for the
              callback.
            </DialogDescription>
          </DialogHeader>
          {/* Keyed so a reopened dialog starts empty rather than from the last
              visitor's half-typed details. */}
          {open ? (
            <VisitorForm key={String(open)} {...context} onSaved={() => setOpen(false)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
