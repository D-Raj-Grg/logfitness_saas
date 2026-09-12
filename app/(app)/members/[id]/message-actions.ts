'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import {
  previewMemberNotification,
  sendMemberNotification,
  type MemberMessagePreview,
} from '@/lib/db/notifications'
import { manualNotificationEventSchema, memberMessageSchema } from '@/lib/validation/notifications'

export type MemberMessageState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[]>
}

type DbError = { code?: string; message?: string }

/**
 * The RPCs raise sentences -- "This member has asked not to receive messages"
 * is the whole answer -- so the message is passed through, exactly as the
 * notification log's actions do. Anything without one is mapped rather than
 * leaked.
 */
function dbErrorMessage(error: unknown) {
  const { code, message } = (error ?? {}) as DbError
  if (message) return message
  if (code === '42501') return 'You cannot message a member at a branch you do not cover.'
  if (code === 'P0002') return 'That member no longer exists.'
  return 'Something went wrong. Try again.'
}

/**
 * Owner, manager and front desk: the desk is who chases dues. A trainer is
 * refused here and again by `member_message_target`, because the database is
 * the boundary and the screen should not offer what the database will refuse.
 */
const MESSAGE_ROLES = ['owner', 'manager', 'front_desk'] as const

export type MemberMessagePreviewResult =
  | { preview: MemberMessagePreview; error?: never }
  | { preview?: never; error: string }

/**
 * What the message would say, fetched when the dialog opens and again when the
 * reason changes. Not a form action: nothing is written, and the dialog needs
 * the answer before it can render anything at all.
 */
export async function previewMemberMessage(
  memberId: string,
  event: string
): Promise<MemberMessagePreviewResult> {
  await requireRole(...MESSAGE_ROLES)

  const parsed = z
    .object({ memberId: z.uuid(), event: manualNotificationEventSchema })
    .safeParse({ memberId, event })
  if (!parsed.success) return { error: 'There is nothing to send.' }

  try {
    const preview = await previewMemberNotification(parsed.data.memberId, parsed.data.event)
    if (!preview) return { error: 'That member is not in your gym.' }
    return { preview }
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }
}

export async function sendMemberMessage(
  _prevState: MemberMessageState,
  formData: FormData
): Promise<MemberMessageState> {
  await requireRole(...MESSAGE_ROLES)

  const parsed = memberMessageSchema.safeParse({
    memberId: formData.get('memberId'),
    event: formData.get('event'),
    channel: formData.get('channel') ?? 'sms',
    body: formData.get('body'),
  })
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  try {
    // The body goes with the send rather than being re-rendered: what the desk
    // read on screen is what the member receives and what the log stores.
    await sendMemberNotification({
      memberId: parsed.data.memberId,
      event: parsed.data.event,
      channel: parsed.data.channel,
      body: parsed.data.body,
    })
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath(`/members/${parsed.data.memberId}`)
  revalidatePath('/members')
  revalidatePath('/notifications')
  return { success: 'Queued. It goes out within a minute.' }
}
