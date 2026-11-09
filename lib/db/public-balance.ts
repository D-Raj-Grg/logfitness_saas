import { createAdminClient } from '@/lib/supabase/admin'
import { balanceLookupSchema, renewalRequestSchema } from '@/lib/validation/balance'

/**
 * The public balance page's data boundary. There is no session: a member
 * scanned the QR on their card and landed on /balance?org=…&card_no=0004.
 *
 * Both RPCs are executable by service_role only and are the anonymous
 * contract -- they resolve the org by slug and answer only what a stranger
 * holding the card could already guess (masked name, plan, status, days
 * left). The service-role client here does nothing but call them; the limit
 * on what leaks is in Postgres, not in this file. The same two RPCs back the
 * public-balance Edge Function for gyms that host the page on their own site.
 */

export type BalanceStatus =
  | 'active'
  | 'expiring'
  | 'expired'
  | 'frozen'
  | 'upcoming'
  | 'none'
  | 'left'

export type PublicBalance =
  | { result: 'org_not_found' }
  | { result: 'card_not_found'; card_no: string }
  | { result: 'card_unassigned'; card_no: string }
  | {
      result: 'ok'
      card_no: string
      name_masked: string
      plan_name: string | null
      status: BalanceStatus
      days_left: number | null
      ends_on: string | null
      renewal_pending: boolean
    }

export type RenewalRequestResult =
  | { result: 'org_not_found' }
  | { result: 'card_not_found'; card_no: string }
  | { result: 'card_unassigned'; card_no: string }
  | { result: 'too_soon'; card_no: string }
  | { result: 'ok'; card_no: string }

const BALANCE_STATUSES: readonly BalanceStatus[] = [
  'active',
  'expiring',
  'expired',
  'frozen',
  'upcoming',
  'none',
  'left',
]

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export async function getPublicBalance(
  orgSlug: string,
  cardNo: string
): Promise<PublicBalance> {
  const parsed = balanceLookupSchema.safeParse({ org: orgSlug, cardNo })
  // A malformed slug cannot name any gym; a malformed number names no card.
  if (!parsed.success) {
    return parsed.error.issues.some((i) => i.path[0] === 'org')
      ? { result: 'org_not_found' }
      : { result: 'card_not_found', card_no: cardNo.replace(/[^0-9]/g, '').slice(0, 4) || '—' }
  }

  const { data, error } = await createAdminClient().rpc('public_card_balance', {
    p_org_slug: parsed.data.org,
    p_card_no: parsed.data.cardNo,
  })
  if (error) throw error

  const row = asRecord(data)
  const result = str(row.result)
  if (result === 'org_not_found') return { result }
  if (result === 'card_not_found' || result === 'card_unassigned') {
    return { result, card_no: str(row.card_no) }
  }
  if (result !== 'ok') {
    throw new Error(`public_card_balance returned an unknown result: ${result}`)
  }

  const status = BALANCE_STATUSES.includes(row.status as BalanceStatus)
    ? (row.status as BalanceStatus)
    : 'none'

  return {
    result: 'ok',
    card_no: str(row.card_no),
    name_masked: str(row.name_masked),
    plan_name: typeof row.plan_name === 'string' ? row.plan_name : null,
    status,
    days_left: typeof row.days_left === 'number' ? row.days_left : null,
    ends_on: typeof row.ends_on === 'string' ? row.ends_on : null,
    renewal_pending: row.renewal_pending === true,
  }
}

export async function submitRenewalRequest(
  orgSlug: string,
  cardNo: string,
  phone?: string | null,
  note?: string | null
): Promise<RenewalRequestResult> {
  const parsed = renewalRequestSchema.safeParse({
    org: orgSlug,
    cardNo,
    phone: phone ?? undefined,
    note: note ?? undefined,
  })
  if (!parsed.success) {
    return parsed.error.issues.some((i) => i.path[0] === 'org')
      ? { result: 'org_not_found' }
      : { result: 'card_not_found', card_no: cardNo.replace(/[^0-9]/g, '').slice(0, 4) || '—' }
  }

  const { data, error } = await createAdminClient().rpc('public_renewal_request', {
    p_org_slug: parsed.data.org,
    p_card_no: parsed.data.cardNo,
    p_phone: parsed.data.phone ?? undefined,
    p_note: parsed.data.note ?? undefined,
  })
  if (error) throw error

  const row = asRecord(data)
  const result = str(row.result)
  if (result === 'org_not_found') return { result }
  if (
    result === 'card_not_found' ||
    result === 'card_unassigned' ||
    result === 'too_soon' ||
    result === 'ok'
  ) {
    return { result, card_no: str(row.card_no) }
  }
  throw new Error(`public_renewal_request returned an unknown result: ${result}`)
}
