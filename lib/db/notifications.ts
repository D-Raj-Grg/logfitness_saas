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

/**
 * One route's remaining credits, exactly as the gateway names them. SMSPasal
 * documents these as strings and answers with numbers, so both are accepted
 * rather than trusting either.
 */
export type GatewayBalanceRoute = {
  ROUTE_ID: string | number
  ROUTE: string
  BALANCE: string | number
}

export type GatewayBalance = {
  pending: boolean
  routes: GatewayBalanceRoute[] | null
  error: string | null
  checked_at: string | null
}

/**
 * Ask the gateway how many credits are left. The answer does not come back
 * here: the API key lives in Vault, so the request is made by the database with
 * pg_net and `readGatewayBalance` collects the reply a moment later.
 */
export async function requestGatewayBalance(providerId: string) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('request_notification_gateway_balance', {
    p_provider_id: providerId,
  })
  if (error) throw error
}

export async function readGatewayBalance(providerId: string) {
  const supabase = await createClient()
  const value = unwrap<unknown>(
    await supabase.rpc('read_notification_gateway_balance', { p_provider_id: providerId })
  )
  return value as GatewayBalance
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

// --------------------------------------------------------------------------
// one member, by hand
// --------------------------------------------------------------------------

export type MemberMessagePreview = {
  to_address: string | null
  subject: string | null
  body: string | null
  opt_out: boolean
  reachable: boolean
  has_gateway: boolean
}

/**
 * What this member would be told, and every reason they would not be. The
 * wording comes back from Postgres rather than being assembled here, so the
 * text the desk reads before pressing Send is the text the sweep would have
 * sent at 02:30.
 */
export async function previewMemberNotification(
  memberId: string,
  event: NotificationEvent,
  channel: NotificationChannel = 'sms'
) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('member_notification_preview', {
    p_member_id: memberId,
    p_event: event,
    p_channel: channel,
  })

  if (error) throw error
  return ((data ?? [])[0] ?? null) as MemberMessagePreview | null
}

/** Returns the message id. A blank body means "use the gym's own wording". */
export async function sendMemberNotification(args: {
  memberId: string
  event: NotificationEvent
  channel?: NotificationChannel
  body?: string | null
  subject?: string | null
}) {
  const supabase = await createClient()

  return unwrap<string>(
    await supabase.rpc('send_member_notification', {
      p_member_id: args.memberId,
      p_event: args.event,
      p_channel: args.channel ?? 'sms',
      p_body: args.body ?? undefined,
      p_subject: args.subject ?? undefined,
    })
  )
}

/**
 * Everything this member has ever been told, newest first, for the profile's
 * own log. `notification_messages_member_idx` covers the order; RLS bounds it
 * to the org and the reader's branches exactly as /notifications is bounded.
 */
export async function listNotificationsForMember(memberId: string, limit = 25) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('notification_messages')
    .select('*')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data ?? []
}

// --------------------------------------------------------------------------
// one visitor, by hand
// --------------------------------------------------------------------------

/**
 * The member preview's twin, minus `opt_out`: a walk-in has no standing
 * instruction to honour, because they have no history with the gym yet. The
 * desk takes them out of the follow-up sweep by marking them "not joining".
 */
export type VisitorMessagePreview = {
  to_address: string | null
  subject: string | null
  body: string | null
  reachable: boolean
  has_gateway: boolean
}

export async function previewVisitorNotification(
  visitorId: string,
  event: NotificationEvent,
  channel: NotificationChannel = 'sms'
) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('visitor_notification_preview', {
    p_visitor_id: visitorId,
    p_event: event,
    p_channel: channel,
  })

  if (error) throw error
  return ((data ?? [])[0] ?? null) as VisitorMessagePreview | null
}

/** Returns the message id. A blank body means "use the gym's own wording". */
export async function sendVisitorNotification(args: {
  visitorId: string
  event: NotificationEvent
  channel?: NotificationChannel
  body?: string | null
  subject?: string | null
}) {
  const supabase = await createClient()

  return unwrap<string>(
    await supabase.rpc('send_visitor_notification', {
      p_visitor_id: args.visitorId,
      p_event: args.event,
      p_channel: args.channel ?? 'sms',
      p_body: args.body ?? undefined,
      p_subject: args.subject ?? undefined,
    })
  )
}
