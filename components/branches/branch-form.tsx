'use client'

import { useActionState, useEffect } from 'react'

import {
  createBranchAction,
  updateBranchAction,
  type BranchFormState,
} from '@/app/(app)/branches/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { BranchListRow } from '@/components/branches/branches-table'

export function BranchForm({
  branch,
  onSaved,
}: {
  branch?: BranchListRow
  onSaved?: () => void
}) {
  const [state, formAction, pending] = useActionState<BranchFormState, FormData>(
    branch ? updateBranchAction : createBranchAction,
    {}
  )

  useEffect(() => {
    if (state.success) onSaved?.()
  }, [state, onSaved])

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {branch ? <input type="hidden" name="branchId" value={branch.id} /> : null}

      <AuthFormMessage error={state.error} notice={state.success} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={branch?.name} required />
        <FieldError messages={state.fieldErrors?.name} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="address">Address (optional)</Label>
        <Input id="address" name="address" defaultValue={branch?.address ?? ''} />
        <FieldError messages={state.fieldErrors?.address} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="phone">Phone (optional)</Label>
        <Input
          id="phone"
          name="phone"
          inputMode="tel"
          defaultValue={branch?.phone ?? ''}
        />
        <FieldError messages={state.fieldErrors?.phone} />
      </div>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : branch ? 'Save changes' : 'Add branch'}
        </Button>
      </div>
    </form>
  )
}
