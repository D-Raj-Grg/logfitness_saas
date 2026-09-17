'use client'

import { useActionState, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { stopAnnouncement, type AnnouncementState } from '@/app/(app)/announcements/actions'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

/**
 * Stopping a broadcast is asked about first. Every other row action here is
 * one message; this one is hundreds, and half of them may already have gone --
 * which is exactly what the confirmation says, because "cancel" reads as
 * "undo" and it is not one.
 */
export function AnnouncementRowActions({ id, title }: { id: string; title: string }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<AnnouncementState, FormData>(
    stopAnnouncement,
    {}
  )

  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (state.success) toast.success(state.success)
  }, [state])

  // Closed by deriving rather than by setting state from the effect: once the
  // action has answered there is nothing left to confirm, and the row itself
  // is about to disappear when the page revalidates.
  const showing = open && !state.success

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Stop
      </Button>

      <AlertDialog open={showing} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop “{title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops the messages that have not gone out yet. Anything already
              delivered cannot be recalled, and the people who got it will not be told
              otherwise.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Leave it running</AlertDialogCancel>
            <form action={formAction}>
              <input type="hidden" name="id" value={id} />
              <AlertDialogAction type="submit" disabled={pending}>
                {pending ? 'Stopping…' : 'Stop the rest'}
              </AlertDialogAction>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
