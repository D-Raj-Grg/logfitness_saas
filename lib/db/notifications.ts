import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type NotificationMessageRow = Database['public']['Tables']['notification_messages']['Row']
export type NotificationProviderRow = Database['public']['Tables']['notification_providers']['Row']
export type NotificationRuleRow = Database['public']['Tables']['notification_rules']['Row']
export type NotificationTemplateRow = Database['public']['Tables']['notification_templates']['Row']

export type NotificationChannel = Database['public']['Enums']['notification_channel']
export type NotificationEvent = Database['public']['Enums']['notification_event']
export type NotificationProvider = Database['public']['Enums']['notification_provider']
export type NotificationStatus = Database['public']['Enums']['notification_status']

function unwrap<T>(result: { data: unknown; error: { message: string; code?: string } | null }) {
  if (result.error) throw result.error
  return result.data as T
}

export type NotificationListFilter = {
  /** null = every branch RLS allows, which is what an owner sees by default. */
  branchIds: string[] | null
  status?: NotificationStatus
  event?: NotificationEvent
  channel?: NotificationChannel
  /** Free text over the recipient address and the message itself. */
  q?: string
  page: number
  pageSize: number
}

export type NotificationListResult = {
  rows: NotificationMessageRow[]
  total: number
  page: number
  pageSize: number
}

/**
 * The delivery log, newest first. RLS bounds it to the org and, for anyone who
 * is not an owner or a manager, to their own branches; `branchIds` is the
 * branch switcher's filter on top of that.
 */
export async function listNotifications(
  filter: NotificationListFilter
): Promise<NotificationListResult> {
  const supabase = await createClient()

  let request = supabase
    .from('notification_messages')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    // A sweep writes every row of a batch in one transaction, so created_at
    // repeats. Without a unique final sort key a row can land on two pages
    // while another lands on none.
    .order('id', { ascending: false })

  if (filter.branchIds) {
    // A message raised for the whole org carries no branch; it belongs to
    // everyone who can see the org rather than to nobody.
    request = request.or(
      `branch_id.is.null,branch_id.in.(${filter.branchIds.join(',')})`
    )
  }

  if (filter.status) request = request.eq('status', filter.status)
  if (filter.event) request = request.eq('event', filter.event)
  if (filter.channel) request = request.eq('channel', filter.channel)

  const term = filter.q?.trim()
  if (term) {
    const escaped = term.replace(/[%_,()]/g, ' ').trim()
    if (escaped) {
      request = request.or(`to_address.ilike.%${escaped}%,body.ilike.%${escaped}%`)
    }
  }

  const from = (filter.page - 1) * filter.pageSize
  const { data, error, count } = await request.range(from, from + filter.pageSize - 1)

  if (error) throw error

  return {
    rows: data ?? [],
    total: count ?? 0,
    page: filter.page,
    pageSize: filter.pageSize,
  }
}

/**
 * How many messages are sitting in each state, for the log's summary strip.
 *
 * One `head: true` count per state rather than selecting every row and counting
 * in TypeScript: a chain sending thirty thousand messages a month would have
 * pulled all of them across the wire to produce four integers, and any
 * `db-max-rows` cap would have silently made the numbers wrong rather than slow.
 */
export async function notificationStatusCounts(
  branchIds: string[] | null,
  statuses: readonly NotificationStatus[]
) {
  const supabase = await createClient()

  const results = await Promise.all(
    statuses.map(async (status) => {
      let request = supabase
        .from('notification_messages')
        .select('id', { count: 'exact', head: true })
        .eq('status', status)

      if (branchIds) {
        request = request.or(`branch_id.is.null,branch_id.in.(${branchIds.join(',')})`)
      }

      const { count, error } = await request
      if (error) throw error
      return [status, count ?? 0] as const
    })
  )

  return Object.fromEntries(results) as Partial<Record<NotificationStatus, number>>
}

// --------------------------------------------------------------------------
// gateways
// --------------------------------------------------------------------------

export async function listNotificationProviders() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('notification_providers')
    .select('*')
    .order('channel', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw error
  return data ?? []
}

/**
 * Whether a gateway holds a token. Deliberately a boolean and not the token:
 * `notification_credential` is callable by no client role at all, so there is
 * no path from the console to the secret itself.
 */
export async function notificationHasCredential(providerId: string) {
  const supabase = await createClient()
  return unwrap<boolean>(
    await supabase.rpc('notification_has_credential', { p_provider_id: providerId })
  )
}

export async function insertNotificationProvider(
  values: Database['public']['Tables']['notification_providers']['Insert']
) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('notification_providers')
    .insert(values)
    .select('id')
    .single()

  if (error) throw error
  return data
}

export async function updateNotificationProvider(
  providerId: string,
  values: Database['public']['Tables']['notification_providers']['Update']
) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('notification_providers')
    .update(values)
    .eq('id', providerId)

  if (error) throw error
}

export async function deleteNotificationProvider(providerId: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('notification_providers')
    .delete()
    .eq('id', providerId)

  if (error) throw error
}

export async function setNotificationCredential(providerId: string, token: string) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('set_notification_credential', {
    p_provider_id: providerId,
    p_secret: token,
  })
  if (error) throw error
}

export async function clearNotificationCredential(providerId: string) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('clear_notification_credential', {
    p_provider_id: providerId,
  })
  if (error) throw error
}

// --------------------------------------------------------------------------
// rules
// --------------------------------------------------------------------------

export async function listNotificationRules() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('notification_rules')
    .select('*')
    .order('event', { ascending: true })
    .order('offset_days', { ascending: false })
    .order('id', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function updateNotificationRule(
  ruleId: string,
  values: Database['public']['Tables']['notification_rules']['Update']
) {
  const supabase = await createClient()

  const { error } = await supabase.from('notification_rules').update(values).eq('id', ruleId)
  if (error) throw error
}

// --------------------------------------------------------------------------
// templates
// --------------------------------------------------------------------------

export async function listNotificationTemplates() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('notification_templates')
    .select('*')
    .order('event', { ascending: true })
    .order('channel', { ascending: true })
    .order('locale', { ascending: true })

  if (error) throw error
  return data ?? []
}

/**
 * What a message would actually say: the org's own wording when it has edited
 * one, and the built-in otherwise. Reading it through the database rather than
 * duplicating the defaults in TypeScript is what keeps the preview honest.
 *
 * This is the console's half of a deliberate split. The nightly sweeps use
 * `resolve_notification_template`, which is SECURITY DEFINER and callable by no
 * client role, because cron holds no claims and must resolve wording for every
 * org. This one is SECURITY INVOKER, so it returns the caller's own gym's row
 * through RLS and nothing at all for anybody else's.
 */
export async function previewNotificationTemplate(
  orgId: string,
  event: NotificationEvent,
  channel: NotificationChannel,
  locale: string
) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('notification_template_preview', {
    p_org_id: orgId,
    p_event: event,
    p_channel: channel,
    p_locale: locale,
  })

  if (error) throw error
  return (data ?? [])[0] ?? null
}

export async function upsertNotificationTemplate(
  values: Database['public']['Tables']['notification_templates']['Insert']
) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('notification_templates')
    .upsert(values, { onConflict: 'org_id,event,channel,locale' })

  if (error) throw error
}

/** Drop an org's wording so the built-in takes over again. */
export async function deleteNotificationTemplate(templateId: string) {
  const supabase = await createClient()

  const { error } = await supabase.from('notification_templates').delete().eq('id', templateId)
  if (error) throw error
}

// --------------------------------------------------------------------------
// one message
// --------------------------------------------------------------------------

export async function enqueueNotification(args: {
  channel: NotificationChannel
  event: NotificationEvent
  to: string
  body: string
  subject?: string | null
  memberId?: string | null
  staffId?: string | null
  branchId?: string | null
  dedupeKey?: string | null
}) {
  const supabase = await createClient()

  return unwrap<string>(
    await supabase.rpc('enqueue_notification', {
      p_channel: args.channel,
      p_event: args.event,
      p_to: args.to,
      p_body: args.body,
      p_subject: args.subject ?? undefined,
      p_member_id: args.memberId ?? undefined,
      p_staff_id: args.staffId ?? undefined,
      p_branch_id: args.branchId ?? undefined,
      p_dedupe_key: args.dedupeKey ?? undefined,
    })
  )
}

export async function retryNotification(notificationId: string) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('retry_notification', { p_id: notificationId })
  if (error) throw error
}

export async function cancelNotification(notificationId: string) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_notification', { p_id: notificationId })
  if (error) throw error
}
