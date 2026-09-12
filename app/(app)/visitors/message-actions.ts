'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import {
  previewVisitorNotification,
  sendVisitorNotification,
  type VisitorMessagePreview,
} from '@/lib/db/notifications'
import {
  visitorMessageEventSchema,
  visitorMessageSchema,
} from '@/lib/validation/notifications'

export type VisitorMessageState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[]>
}

type DbError = { code?: string; message?: string }

/**
 * The RPCs raise sentences -- "That visitor is a member now" is the whole
 * answer -- so the message is passed through, as the member send does.
 */
function dbErrorMessage(error: unknown) {
  const { code, message } = (error ?? {}) as DbError
  if (message) return message
  if (code === '42501') return 'You cannot message a visitor at a branch you do not cover.'
  if (code === 'P0002') return 'That visitor no longer exists.'
  return 'Something went wrong. Try again.'
}

/**
 * Owner, manager and front desk. A trainer may log a walk-in -- every role may
 * -- and is refused here and again by `visitor_message_target`, because the
 * database is the boundary and the screen should not offer what it will refuse.
 */
const MESSAGE_ROLES = ['owner', 'manager', 'front_desk'] as const

export type VisitorMessagePreviewResult =
  | { preview: VisitorMessagePreview; error?: never }
  | { preview?: never; error: string }

/**
 * What the message would say, fetched when the dialog opens and again when the
 * reason changes. Not a form action: nothing is written, and the dialog needs
 * the answer before it can render anything.
 */
export async function previewVisitorMessage(
  visitorId: string,
  event: string
): Promise<VisitorMessagePreviewResult> {
  await requireRole(...MESSAGE_ROLES)

  const parsed = z
    .object({ visitorId: z.uuid(), event: visitorMessageEventSchema })
    .safeParse({ visitorId, event })
  if (!parsed.success) return { error: 'There is nothing to send.' }

  try {
    const preview = await previewVisitorNotification(parsed.data.visitorId, parsed.data.event)
    if (!preview) return { error: 'That visitor is not in your gym.' }
    return { preview }
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }
}

/**
 * The dialog's send: the body is whatever the desk has on screen, edited or
 * not, because what was sent and what the log stores have to be the same
 * sentence.
 */
export async function sendVisitorMessage(
  _prevState: VisitorMessageState,
  formData: FormData
): Promise<VisitorMessageState> {
  await requireRole(...MESSAGE_ROLES)

  const parsed = visitorMessageSchema.safeParse({
    visitorId: formData.get('visitorId'),
    event: formData.get('event'),
    channel: formData.get('channel') ?? 'sms',
    body: formData.get('body'),
  })
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  try {
    await sendVisitorNotification({
      visitorId: parsed.data.visitorId,
      event: parsed.data.event,
      channel: parsed.data.channel,
      body: parsed.data.body,
    })
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/visitors')
  revalidatePath('/notifications')
  return { success: 'Queued. It goes out within a minute.' }
}

/**
 * The one-click welcome from the row menu. No dialog, no preview: the gym's
 * own wording, rendered in Postgres, sent as it stands. A desk clearing a
 * morning's walk-ins should not have to read the same sentence six times.
 */
export async function sendVisitorWelcome(
  _prevState: VisitorMessageState,
  formData: FormData
): Promise<VisitorMessageState> {
  await requireRole(...MESSAGE_ROLES)

  const parsed = z.object({ visitorId: z.uuid() }).safeParse({
    visitorId: formData.get('visitorId'),
  })
  if (!parsed.success) {
    return { error: 'That visitor could not be found.' }
  }

  try {
    // No body: `send_visitor_notification` renders the template itself, which
    // is what keeps this identical to the automatic welcome.
    await sendVisitorNotification({
      visitorId: parsed.data.visitorId,
      event: 'visitor_welcome',
    })
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/visitors')
  revalidatePath('/notifications')
  return { success: 'Welcome SMS queued.' }
}
