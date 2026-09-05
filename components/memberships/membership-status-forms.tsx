'use client'

import { useActionState, useEffect } from 'react'

import {
  cancelMembership,
  freezeMembership,
  unfreezeMembership,
  type MembershipActionState,
} from '@/app/(app)/members/[id]/membership-actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Props = {
  memberId: string
  membershipId: string
  onSuccess: (message: string) => void
}

function useCloseOnSuccess(state: MembershipActionState, onSuccess: Props['onSuccess']) {
  useEffect(() => {
    if (state.success) onSuccess(state.success)
  }, [state.success, onSuccess])
}

export function FreezeForm({ memberId, membershipId, onSuccess }: Props) {
  const [state, formAction, pending] = useActionState<MembershipActionState, FormData>(
    freezeMembership,
    {}
  )
  useCloseOnSuccess(state, onSuccess)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <AuthFormMessage error={state.error} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="freeze-notes">Notes (optional)</Label>
        <Textarea
          id="freeze-notes"
          name="notes"
          rows={2}
          maxLength={2000}
          placeholder="Travelling, injury, ..."
        />
        <FieldError messages={state.fieldErrors?.notes} />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : 'Freeze membership'}
        </Button>
      </div>
    </form>
  )
}

/** Rendered inside an AlertDialog: the only input is the confirmation. */
export function UnfreezeForm({
  memberId,
  membershipId,
  onSuccess,
  cancelButton,
}: Props & { cancelButton: React.ReactNode }) {
  const [state, formAction, pending] = useActionState<MembershipActionState, FormData>(
    unfreezeMembership,
    {}
  )
  useCloseOnSuccess(state, onSuccess)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <AuthFormMessage error={state.error} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {cancelButton}
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : 'Unfreeze'}
        </Button>
      </div>
    </form>
  )
}

export function CancelForm({ memberId, membershipId, onSuccess }: Props) {
  const [state, formAction, pending] = useActionState<MembershipActionState, FormData>(
    cancelMembership,
    {}
  )
  useCloseOnSuccess(state, onSuccess)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <AuthFormMessage error={state.error} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="cancel-reason">Reason</Label>
        <Textarea
          id="cancel-reason"
          name="reason"
          rows={2}
          required
          minLength={3}
          maxLength={500}
          placeholder="Why the membership is being cancelled"
        />
        <FieldError messages={state.fieldErrors?.reason} />
      </div>

      <div className="flex justify-end">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? 'Saving...' : 'Cancel membership'}
        </Button>
      </div>
    </form>
  )
}
