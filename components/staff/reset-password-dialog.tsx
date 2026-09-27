'use client'

import { useActionState, useEffect, useState } from 'react'

import { resetStaffPassword, type StaffFormState } from '@/app/(app)/staff/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { StaffListRow } from '@/components/staff/staff-table'

function ResetPasswordForm({
  row,
  onDone,
}: {
  row: StaffListRow
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<StaffFormState, FormData>(
    resetStaffPassword,
    {}
  )

  useEffect(() => {
    if (!state.success) return
    // Leave the confirmation on screen long enough to read before closing.
    const timer = setTimeout(onDone, 1500)
    return () => clearTimeout(timer)
  }, [state, onDone])

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="staffId" value={row.id} />

      <AuthFormMessage error={state.error} notice={state.success} />

      <div className="flex flex-col gap-2">
        <Label htmlFor={`password-${row.id}`}>New password</Label>
        <Input
          id={`password-${row.id}`}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <FieldError messages={state.fieldErrors?.password} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`confirm-${row.id}`}>Confirm password</Label>
        <Input
          id={`confirm-${row.id}`}
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        <FieldError messages={state.fieldErrors?.confirm} />
      </div>

      <p className="text-sm text-muted-foreground">
        Share the new password with them directly. Their old one stops working
        immediately.
      </p>

      <div>
        <Button type="submit" disabled={pending || Boolean(state.success)}>
          {pending ? 'Saving...' : 'Set password'}
        </Button>
      </div>
    </form>
  )
}

export function ResetPasswordDialog({ row }: { row: StaffListRow }) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        Reset password
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password for {row.full_name}</DialogTitle>
          <DialogDescription>
            Use this when they have forgotten it. They can change it again
            themselves from the sign-in page.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed so a reopened dialog starts clean, not with a stale result. */}
        {open ? (
          <ResetPasswordForm key={row.id} row={row} onDone={() => setOpen(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
