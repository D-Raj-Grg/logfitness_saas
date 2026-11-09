'use client'

import { useState } from 'react'

import { handleRenewalRequest, type MemberFormState } from '@/app/(app)/members/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
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
import { useDismissibleActionState } from '@/hooks/use-dismissible-action-state'

/**
 * Mark done: an inline one-click submit. Renewing the member at the desk
 * closes the request on its own, so this only covers a request settled some
 * other way, and does not deserve a dialog.
 */
function MarkDoneButton({ requestId }: { requestId: string }) {
  const [state, formAction, pending] = useDismissibleActionState<MemberFormState>(
    handleRenewalRequest,
    {}
  )
  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="status" value="done" />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? 'Saving...' : 'Mark done'}
      </Button>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
    </form>
  )
}

/** Reject: a confirmation with an optional note the member never sees. */
function RejectDialog({ requestId, fullName }: { requestId: string; fullName: string }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending, dismiss] = useDismissibleActionState<MemberFormState>(
    async (prev, formData) => {
      const result = await handleRenewalRequest(prev, formData)
      if (result.success) setOpen(false)
      return result
    },
    {}
  )
  const onOpenChange = (next: boolean) => {
    dismiss()
    setOpen(next)
  }
  const noteId = `reject-note-${requestId}`

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>Reject</AlertDialogTrigger>
      <AlertDialogContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="status" value="rejected" />
          <AlertDialogHeader>
            <AlertDialogTitle>Reject {fullName}&apos;s request?</AlertDialogTitle>
            <AlertDialogDescription>
              The request leaves the waiting list. Nothing is sent to the member; the note is
              for the desk.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AuthFormMessage error={state.error} />

          <div className="flex flex-col gap-2">
            <Label htmlFor={noteId}>Note (optional)</Label>
            <Textarea id={noteId} name="note" maxLength={500} placeholder="Could not reach them" />
            <FieldError messages={state.fieldErrors?.note} />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Rejecting...' : 'Reject request'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The two ways to close a pending request without renewing. */
export function RenewalRequestActions({
  requestId,
  fullName,
}: {
  requestId: string
  fullName: string
}) {
  return (
    <>
      <MarkDoneButton requestId={requestId} />
      <RejectDialog requestId={requestId} fullName={fullName} />
    </>
  )
}
