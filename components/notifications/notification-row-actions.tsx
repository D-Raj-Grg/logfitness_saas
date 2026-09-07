'use client'

import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'

import {
  resendNotification,
  stopNotification,
  type NotificationActionState,
} from '@/app/(app)/notifications/actions'
import { Button } from '@/components/ui/button'
import type { NotificationStatus } from '@/lib/db/notifications'

const RESENDABLE: NotificationStatus[] = ['failed', 'cancelled', 'skipped']

/**
 * A row's own actions. These were plain forms posting a void action, which
 * meant a refusal -- a manager resending a message raised at a branch they do
 * not cover -- looked identical to success: the page simply did not change.
 */
export function NotificationRowActions({
  notificationId,
  status,
}: {
  notificationId: string
  status: NotificationStatus
}) {
  const [resendState, resendAction, resending] = useActionState<
    NotificationActionState,
    FormData
  >(resendNotification, {})
  const [cancelState, cancelAction, cancelling] = useActionState<
    NotificationActionState,
    FormData
  >(stopNotification, {})

  useEffect(() => {
    if (resendState.error) toast.error(resendState.error)
    if (resendState.success) toast.success(resendState.success)
  }, [resendState])

  useEffect(() => {
    if (cancelState.error) toast.error(cancelState.error)
    if (cancelState.success) toast.success(cancelState.success)
  }, [cancelState])

  return (
    <div className="flex justify-end gap-1">
      {RESENDABLE.includes(status) ? (
        <form action={resendAction}>
          <input type="hidden" name="notificationId" value={notificationId} />
          <Button type="submit" variant="outline" size="sm" disabled={resending}>
            {resending ? 'Sending...' : 'Send again'}
          </Button>
        </form>
      ) : null}

      {status === 'queued' ? (
        <form action={cancelAction}>
          <input type="hidden" name="notificationId" value={notificationId} />
          <Button type="submit" variant="ghost" size="sm" disabled={cancelling}>
            {cancelling ? 'Cancelling...' : 'Cancel'}
          </Button>
        </form>
      ) : null}
    </div>
  )
}
