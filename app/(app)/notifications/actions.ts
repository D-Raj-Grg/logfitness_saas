'use server'

import { revalidatePath } from 'next/cache'

import { requireRole } from '@/lib/auth'
import { cancelNotification, retryNotification } from '@/lib/db/notifications'
import { notificationIdSchema } from '@/lib/validation/notifications'

export type NotificationActionState = {
  error?: string
  success?: string
}

type DbError = { code?: string; message?: string }

/**
 * The RPCs raise sentences, not codes -- "only an owner or the branch manager
 * can resend a message" is the whole answer -- so the message is passed
 * through. Anything without one is mapped rather than leaked.
 */
function dbErrorMessage(error: unknown) {
  const { code, message } = (error ?? {}) as DbError
  if (code === '42501') {
    return 'You cannot resend a message raised at a branch you do not cover.'
  }
  if (code === 'P0002') return 'That message no longer exists.'
  if (message) return message
  return 'Something went wrong. Try again.'
}

/**
 * Owner and manager, stated here as well as enforced in the RPC. The database
 * is the boundary -- retry_notification refuses a front desk, a trainer, and a
 * manager of another branch, and the gate asserts it -- but every other action
 * in this console states its own rule too, and a screen whose server half
 * accepts more than its UI offers is a question someone has to answer later.
 */
export async function resendNotification(
  _prevState: NotificationActionState,
  formData: FormData
): Promise<NotificationActionState> {
  await requireRole('owner', 'manager')

  const parsed = notificationIdSchema.safeParse({
    notificationId: formData.get('notificationId'),
  })
  if (!parsed.success) return { error: 'That message does not exist.' }

  try {
    await retryNotification(parsed.data.notificationId)
  } catch (error) {
    // Never swallowed. A manager whose branch does not cover the message is
    // refused by the database, and silence would look exactly like a resend
    // that worked.
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/notifications')
  return { success: 'Queued again. It goes out within a minute.' }
}

export async function stopNotification(
  _prevState: NotificationActionState,
  formData: FormData
): Promise<NotificationActionState> {
  await requireRole('owner', 'manager')

  const parsed = notificationIdSchema.safeParse({
    notificationId: formData.get('notificationId'),
  })
  if (!parsed.success) return { error: 'That message does not exist.' }

  try {
    await cancelNotification(parsed.data.notificationId)
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/notifications')
  return { success: 'Cancelled. It will not be sent.' }
}
