import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type AnnouncementRow = Database['public']['Tables']['announcements']['Row']
export type AnnouncementOverviewRow =
  Database['public']['Views']['announcement_overview']['Row']

export type AnnouncementAudience = Database['public']['Enums']['announcement_audience']
export type AnnouncementStatus = Database['public']['Enums']['announcement_status']
export type MemberStatus = Database['public']['Enums']['member_status']
export type NotificationChannel = Database['public']['Enums']['notification_channel']

function unwrap<T>(result: { data: unknown; error: { message: string; code?: string } | null }) {
  if (result.error) throw result.error
  return result.data as T
}

export type AnnouncementListResult = {
  rows: AnnouncementOverviewRow[]
  total: number
  page: number
  pageSize: number
}

/**
 * The log, newest first. The counts on each row are read off the outbox by the
 * view rather than stored, so a send that is still going up-counts on refresh
 * without anything having to write to the announcement.
 */
export async function listAnnouncements(args: {
  page: number
  pageSize: number
}): Promise<AnnouncementListResult> {
  const supabase = await createClient()

  const from = (args.page - 1) * args.pageSize

  const { data, error, count } = await supabase
    .from('announcement_overview')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    // Two announcements sent in the same second would otherwise be able to
    // swap places between pages.
    .order('id', { ascending: false })
    .range(from, from + args.pageSize - 1)

  if (error) throw error

  return {
    rows: (data ?? []) as AnnouncementOverviewRow[],
    total: count ?? 0,
    page: args.page,
    pageSize: args.pageSize,
  }
}

export async function getAnnouncement(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('announcement_overview')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as AnnouncementOverviewRow | null
}

export type AnnouncementAudienceCount = {
  total: number
  reachable: number
  unusable: number
  members: number
  visitors: number
}

/**
 * Who would get it. Called as the composer's filters change, so it is a plain
 * read with no side effects -- the same function the send itself uses to build
 * the audience, which is what stops the number on screen and the number of
 * messages written from ever disagreeing.
 */
export async function countAnnouncementAudience(args: {
  audience: AnnouncementAudience
  branchId?: string | null
  memberStatuses?: MemberStatus[] | null
  visitorDays?: number | null
  channel?: NotificationChannel
}): Promise<AnnouncementAudienceCount> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('announcement_audience_count', {
    p_audience: args.audience,
    p_branch_id: args.branchId ?? undefined,
    p_member_statuses: args.memberStatuses?.length ? args.memberStatuses : undefined,
    p_visitor_days: args.visitorDays ?? undefined,
    p_channel: args.channel ?? 'sms',
  })

  if (error) throw error

  const row = (data ?? [])[0]
  return {
    total: row?.total ?? 0,
    reachable: row?.reachable ?? 0,
    unusable: row?.unusable ?? 0,
    members: row?.members ?? 0,
    visitors: row?.visitors ?? 0,
  }
}

/** Composes and fans out in one transaction. Returns the announcement id. */
export async function sendAnnouncement(args: {
  title: string
  body: string
  audience: AnnouncementAudience
  channel?: NotificationChannel
  branchId?: string | null
  memberStatuses?: MemberStatus[] | null
  visitorDays?: number | null
  scheduledFor?: string | null
}) {
  const supabase = await createClient()

  return unwrap<string>(
    await supabase.rpc('send_announcement', {
      p_title: args.title,
      p_body: args.body,
      p_audience: args.audience,
      p_channel: args.channel ?? 'sms',
      p_branch_id: args.branchId ?? undefined,
      p_member_statuses: args.memberStatuses?.length ? args.memberStatuses : undefined,
      p_visitor_days: args.visitorDays ?? undefined,
      p_scheduled_for: args.scheduledFor ?? undefined,
    })
  )
}

/**
 * One message, to a number typed by hand, rendered exactly as the real send
 * would render it. No announcement row: nothing has been announced yet.
 */
export async function sendAnnouncementTest(args: {
  body: string
  to: string
  title?: string | null
  channel?: NotificationChannel
}) {
  const supabase = await createClient()

  return unwrap<string>(
    await supabase.rpc('send_announcement_test', {
      p_body: args.body,
      p_to: args.to,
      p_channel: args.channel ?? 'sms',
      p_title: args.title ?? undefined,
    })
  )
}

/** Returns how many were actually stopped. Anything already gone stays gone. */
export async function cancelAnnouncement(id: string) {
  const supabase = await createClient()

  return unwrap<number>(await supabase.rpc('cancel_announcement', { p_id: id }))
}
