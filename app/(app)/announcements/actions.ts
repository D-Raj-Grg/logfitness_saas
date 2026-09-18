'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import {
  cancelAnnouncement,
  countAnnouncementAudience,
  sendAnnouncement,
  sendAnnouncementTest,
  type AnnouncementAudienceCount,
  type MemberStatus,
} from '@/lib/db/announcements'
import {
  announcementAudienceQuerySchema,
  announcementComposeSchema,
  announcementTestSchema,
} from '@/lib/validation/announcements'

export type AnnouncementState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[]>
}

type DbError = { code?: string; message?: string }

/**
 * The RPCs raise whole sentences -- "Nobody matches that audience" is the
 * complete answer -- so the message is passed through, the way the member and
 * visitor sends do.
 */
function dbErrorMessage(error: unknown) {
  const { code, message } = (error ?? {}) as DbError
  if (message) return message
  if (code === '42501') return 'Only an owner, manager or front desk can send an announcement.'
  if (code === 'P0002') return 'That announcement no longer exists.'
  return 'Something went wrong. Try again.'
}

/**
 * A broadcast spends the gym's SMS credit on hundreds of messages at once, and
 * until 2026-09-18 that put it one role above the desk. It does not any more:
 * the person standing at the door on the morning the gym is shut is the one
 * who knows, and `announcement_branch_scope` bounds a desk to its own branches
 * anyway, so the role widened and the reach did not.
 *
 * `jwt_can_announce()` is the authority — it also refuses a desk with no branch
 * of its own, because an empty claim would mean the whole chain. A trainer is
 * still refused everywhere.
 */
const ANNOUNCE_ROLES = ['owner', 'manager', 'front_desk'] as const

export type AnnouncementAudienceResult =
  | { count: AnnouncementAudienceCount; error?: never }
  | { count?: never; error: string }

/**
 * What the composer shows above the Send button. Not a form action: nothing is
 * written, and the dialog needs the number before it can let anybody commit
 * to it.
 */
export async function previewAnnouncementAudience(input: {
  audience: string
  branchId?: string | null
  memberStatuses?: string[]
  visitorDays?: number | null
}): Promise<AnnouncementAudienceResult> {
  await requireRole(...ANNOUNCE_ROLES)

  const parsed = announcementAudienceQuerySchema.safeParse({
    audience: input.audience,
    branchId: input.branchId ?? undefined,
    memberStatuses: input.memberStatuses,
    visitorDays: input.visitorDays ?? undefined,
    channel: 'sms',
  })
  if (!parsed.success) return { error: 'There is nobody to count.' }

  try {
    const count = await countAnnouncementAudience({
      audience: parsed.data.audience,
      branchId: parsed.data.branchId ?? null,
      memberStatuses: (parsed.data.memberStatuses ?? []) as MemberStatus[],
      visitorDays: parsed.data.visitorDays ?? null,
      channel: parsed.data.channel,
    })
    return { count }
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }
}

/**
 * Send, or schedule. There is no draft: an announcement that has not been sent
 * is a thing nobody has to remember, and a half-finished one in a list is a
 * closure notice waiting to be forgotten.
 */
export async function createAnnouncement(
  _prevState: AnnouncementState,
  formData: FormData
): Promise<AnnouncementState> {
  await requireRole(...ANNOUNCE_ROLES)

  const rawStatuses = formData.getAll('memberStatuses').map(String).filter(Boolean)
  const rawBranch = String(formData.get('branchId') ?? '')
  const rawDays = String(formData.get('visitorDays') ?? '')
  const rawSchedule = String(formData.get('scheduledFor') ?? '')

  const parsed = announcementComposeSchema.safeParse({
    title: formData.get('title'),
    body: formData.get('body'),
    audience: formData.get('audience'),
    channel: 'sms',
    branchId: rawBranch === '' || rawBranch === 'all' ? null : rawBranch,
    memberStatuses: rawStatuses,
    visitorDays: rawDays === '' || rawDays === 'all' ? null : rawDays,
    scheduledFor: rawSchedule === '' ? null : rawSchedule,
  })
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  let scheduled = false
  try {
    await sendAnnouncement({
      title: parsed.data.title,
      body: parsed.data.body,
      audience: parsed.data.audience,
      channel: parsed.data.channel,
      branchId: parsed.data.branchId ?? null,
      memberStatuses: (parsed.data.memberStatuses ?? []) as MemberStatus[],
      visitorDays: parsed.data.visitorDays ?? null,
      scheduledFor: parsed.data.scheduledFor ?? null,
    })
    scheduled = Boolean(parsed.data.scheduledFor)
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/announcements')
  revalidatePath('/notifications')
  return {
    success: scheduled
      ? 'Scheduled. Nothing goes out until then, and you can still cancel it.'
      : 'Queued. It starts going out within a minute.',
  }
}

/**
 * Send it to one number first. Called from a button rather than a form -- the
 * composer is already a form and a nested one is not a thing -- so it takes
 * its arguments directly and answers with a sentence for a toast.
 */
export async function testAnnouncement(input: {
  body: string
  to: string
  title?: string
}): Promise<AnnouncementState> {
  await requireRole(...ANNOUNCE_ROLES)

  const parsed = announcementTestSchema.safeParse(input)
  if (!parsed.success) {
    const errors = z.flattenError(parsed.error).fieldErrors
    return { error: errors.to?.[0] ?? errors.body?.[0] ?? 'There is nothing to test.' }
  }

  try {
    await sendAnnouncementTest({
      body: parsed.data.body,
      to: parsed.data.to,
      title: parsed.data.title ?? null,
    })
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/notifications')
  return { success: `Test queued to ${parsed.data.to}. It arrives within a minute.` }
}

/**
 * Stops what has not left yet. The count comes back from the database because
 * "cancelled" is only ever partly true once a send has started, and saying so
 * is the difference between the desk phoning people and not.
 */
export async function stopAnnouncement(
  _prevState: AnnouncementState,
  formData: FormData
): Promise<AnnouncementState> {
  await requireRole(...ANNOUNCE_ROLES)

  const parsed = z.object({ id: z.uuid() }).safeParse({ id: formData.get('id') })
  if (!parsed.success) return { error: 'That announcement could not be found.' }

  let stopped = 0
  try {
    stopped = await cancelAnnouncement(parsed.data.id)
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/announcements')
  revalidatePath('/notifications')
  return {
    success:
      stopped === 0
        ? 'Nothing was left to stop -- it had already gone out.'
        : `Stopped ${stopped} message${stopped === 1 ? '' : 's'} that had not gone yet.`,
  }
}
