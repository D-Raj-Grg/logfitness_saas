import { z } from 'zod'

import { pageSchema, pageSizeSchema } from '@/lib/validation/pagination'

export const announcementAudienceSchema = z.enum(['members', 'visitors', 'both'])

/**
 * SMS only, for now. The enum in the database is wider because the outbox is
 * shared, but a gym has one gateway per channel and only the SMS one is what
 * anybody in Nepal has an account for. Offering Viber here would be offering a
 * send that ends as `skipped`.
 */
export const announcementChannelSchema = z.enum(['sms'])

/**
 * Not `left`. Somebody who has left the gym is not told when it reopens, and
 * an empty selection means the database's own default -- every status but
 * `left` -- rather than nobody.
 */
export const announcementMemberStatusSchema = z.enum(['active', 'expired', 'frozen'])

/**
 * `notification_messages.body` caps at 1,000, so anything longer would be
 * silently truncated at the point where it is too late to see it. The composer
 * shows the segment count; this is only the hard stop.
 */
export const announcementComposeSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the announcement a title').max(120),
    body: z.string().trim().min(1, 'The message cannot be blank').max(1000),
    audience: announcementAudienceSchema,
    channel: announcementChannelSchema.default('sms'),
    branchId: z.uuid().nullable().optional(),
    memberStatuses: z.array(announcementMemberStatusSchema).optional(),
    /** Null is every open visitor. */
    visitorDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
    /**
     * Absent is "send now". A local `datetime-local` value arrives without a
     * zone, so the form sends an ISO string built in the browser's zone --
     * which is the gym's, because the desk is standing in it.
     */
    scheduledFor: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .refine(
    (value) => value.audience !== 'visitors' || !value.memberStatuses?.length,
    { path: ['memberStatuses'], message: 'That filter does not apply to visitors.' }
  )
  .refine((value) => value.audience !== 'members' || value.visitorDays == null, {
    path: ['visitorDays'],
    message: 'That filter does not apply to members.',
  })

export type AnnouncementCompose = z.infer<typeof announcementComposeSchema>

/** What the composer asks for before anything is spent. Nothing is written. */
export const announcementAudienceQuerySchema = z.object({
  audience: announcementAudienceSchema,
  branchId: z.uuid().nullable().optional(),
  memberStatuses: z.array(announcementMemberStatusSchema).optional(),
  visitorDays: z.coerce.number().int().min(1).max(3650).nullable().optional(),
  channel: announcementChannelSchema.default('sms'),
})

export const announcementListQuerySchema = z.object({
  page: pageSchema,
  pageSize: pageSizeSchema,
})

export type AnnouncementListQuery = z.infer<typeof announcementListQuerySchema>
