'use server'

import { revalidatePath } from 'next/cache'

import { requireStaff } from '@/lib/auth'
import { cancelNotification, retryNotification } from '@/lib/db/notifications'
import { notificationIdSchema } from '@/lib/validation/notifications'

export async function resendNotification(formData: FormData): Promise<void> {
  await requireStaff()

  const parsed = notificationIdSchema.safeParse({
    notificationId: formData.get('notificationId'),
  })
  if (!parsed.success) return

  try {
    await retryNotification(parsed.data.notificationId)
  } catch {
    // The row's own last_error is where a failure belongs; a resend that is
    // refused leaves the log exactly as it was.
  }

  revalidatePath('/notifications')
}

export async function stopNotification(formData: FormData): Promise<void> {
  await requireStaff()

  const parsed = notificationIdSchema.safeParse({
    notificationId: formData.get('notificationId'),
  })
  if (!parsed.success) return

  try {
    await cancelNotification(parsed.data.notificationId)
  } catch {
    // Same reasoning as above: a message that has already gone out cannot be
    // cancelled, and saying so on the row is the honest answer.
  }

  revalidatePath('/notifications')
}
