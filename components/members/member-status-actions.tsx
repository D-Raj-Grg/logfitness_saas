'use client'

import { useActionState, useState } from 'react'

import {
  markMemberLeft,
  reactivateMember,
  type MemberFormState,
} from '@/app/(app)/members/actions'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * Mark-as-left and Reactivate for the profile header. Both are destructive
 * enough to confirm: leaving cancels the live membership, and reactivating
 * reopens the record.
 */
export function MemberStatusActions({
  memberId,
  fullName,
  left,
}: {
  memberId: string
  fullName: string
  left: boolean
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<MemberFormState, FormData>(
    async (prev, formData) => {
      const result = await (left ? reactivateMember : markMemberLeft)(prev, formData)
      // The page revalidates behind the dialog, so on success it can simply
      // close; an error stays visible inside it.
      if (result.success) setOpen(false)
      return result
    },
    {}
  )

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button variant={left ? 'outline' : 'destructive'} size="sm" />}
      >
        {left ? 'Reactivate' : 'Mark as left'}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="memberId" value={memberId} />
          <AlertDialogHeader>
            <AlertDialogTitle>
              {left ? `Reactivate ${fullName}?` : `Mark ${fullName} as left?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {left
                ? 'Their record reopens. They will show as expired until a new plan is assigned.'
                : 'Any active membership is cancelled and they drop out of the active list. History and dues are kept.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {left ? null : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="leave-reason">Reason (optional)</Label>
              <Textarea
                id="leave-reason"
                name="reason"
                placeholder="Moved away, joined another gym..."
                maxLength={500}
              />
            </div>
          )}

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="submit"
              variant={left ? 'default' : 'destructive'}
              disabled={pending}
            >
              {pending
                ? 'Working...'
                : left
                  ? 'Reactivate'
                  : 'Mark as left'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
