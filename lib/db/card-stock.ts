import { createClient } from '@/lib/supabase/server'
import { isRangeNotSatisfiable, lastPageFor } from '@/lib/db/paging'
import type { Database } from '@/lib/types/database'
import type { CardStockFilter, CardStockStatus } from '@/lib/validation/cards'

export type CardStockRow = Database['public']['Tables']['card_stock']['Row']
export type MemberCardRow = Database['public']['Tables']['member_cards']['Row']

export type CardStockEffectiveStatus = 'assigned' | 'free' | 'lost' | 'retired'

/**
 * One row of card_stock_overview. The view's columns all come back nullable
 * from the generator; these are the ones the view structurally guarantees.
 */
export type CardStockOverviewRow = Omit<
  Database['public']['Views']['card_stock_overview']['Row'],
  'id' | 'org_id' | 'card_no' | 'card_no_text' | 'status' | 'effective_status' | 'holder_kind' | 'created_at'
> & {
  id: string
  org_id: string
  card_no: number
  card_no_text: string
  status: CardStockStatus
  effective_status: CardStockEffectiveStatus
  holder_kind: 'member' | 'staff' | null
  created_at: string
}

export type CardStockListResult = {
  rows: CardStockOverviewRow[]
  total: number
  page: number
  pageSize: number
}

export type CardStockSummary = {
  total: number
  assigned: number
  free: number
  unlinked: number
  lost: number
  retired: number
}

export type CreateRangeResult = {
  batch_id: string
  from_no: number
  to_no: number
  created: number
}

function unwrap<T>(result: {
  data: unknown
  error: { message: string; code?: string } | null
}) {
  if (result.error) throw result.error
  return result.data as T
}

/**
 * The card list. A term made of digits is a printed number: an exact match,
 * plus every number that starts with those digits ("00" finds 0001 to 0099),
 * because the desk reads the card from across the counter one digit at a time.
 * Anything else looks through the holder's name, their member code, and the
 * chip UID.
 */
export async function listCardStock(args: {
  q: string
  status: CardStockFilter
  page: number
  pageSize: number
}): Promise<CardStockListResult> {
  const supabase = await createClient()

  const build = () => {
    let request = supabase
      .from('card_stock_overview')
      .select('*', { count: 'exact' })

    // "Unlinked" is a free card with no chip yet: printed, numbered, not
    // tapped on a reader. Everything else is one effective status.
    if (args.status === 'unlinked') {
      request = request.eq('effective_status', 'free').is('card_uid', null)
    } else if (args.status !== 'all') {
      request = request.eq('effective_status', args.status)
    }

    const term = args.q.trim()
    if (term) {
      const digits = term.replace(/^no\.?\s*/i, '')
      if (/^\d{1,4}$/.test(digits)) {
        request = request.or(
          `card_no.eq.${Number.parseInt(digits, 10)},card_no_text.like.${digits}%`
        )
      } else {
        const escaped = term.replace(/[%_,()]/g, ' ').trim()
        if (escaped) {
          const hex = escaped.replace(/[^0-9A-Fa-f]/g, '').toUpperCase()
          const uidClause = hex.length >= 2 ? `,card_uid.ilike.${hex}%` : ''
          request = request.or(
            `holder_name.ilike.%${escaped}%,member_code.ilike.${escaped}%${uidClause}`
          )
        }
      }
    }

    return request.order('card_no', { ascending: true })
  }

  let page = args.page
  let from = (page - 1) * args.pageSize
  let { data, error, count } = await build().range(from, from + args.pageSize - 1)

  // A stale bookmark past the last page: show the last real page instead.
  if (error && isRangeNotSatisfiable(error)) {
    const { count: total } = await build().range(0, 0)
    page = lastPageFor(total ?? 0, args.pageSize)
    from = (page - 1) * args.pageSize
    ;({ data, error, count } = await build().range(from, from + args.pageSize - 1))
  }
  if (error) throw error

  return {
    rows: (data ?? []) as CardStockOverviewRow[],
    total: count ?? 0,
    page,
    pageSize: args.pageSize,
  }
}

export async function getCardStockByNo(cardNo: number) {
  const supabase = await createClient()
  return unwrap<CardStockOverviewRow | null>(
    await supabase.from('card_stock_overview').select('*').eq('card_no', cardNo).maybeSingle()
  )
}

/** Counts for the page header. One grouped read of the view, not five counts. */
export async function cardStockSummary(): Promise<CardStockSummary> {
  const supabase = await createClient()
  const rows =
    unwrap<{ effective_status: CardStockEffectiveStatus; card_uid: string | null }[]>(
      await supabase.from('card_stock_overview').select('effective_status, card_uid')
    ) ?? []

  const summary: CardStockSummary = {
    total: rows.length,
    assigned: 0,
    free: 0,
    unlinked: 0,
    lost: 0,
    retired: 0,
  }
  for (const row of rows) {
    summary[row.effective_status] += 1
    if (row.effective_status === 'free' && !row.card_uid) summary.unlinked += 1
  }
  return summary
}

export async function createCardStockRange(args: { from: number; to: number; designId?: string }) {
  const supabase = await createClient()
  return unwrap<CreateRangeResult>(
    await supabase.rpc('create_card_stock_range', {
      p_from: args.from,
      p_to: args.to,
      ...(args.designId ? { p_design_id: args.designId } : {}),
    })
  )
}

export async function nextFreeCardNo() {
  const supabase = await createClient()
  return unwrap<number>(await supabase.rpc('next_free_card_no'))
}

export async function linkCardStockUid(args: { cardNo: number; cardUid: string }) {
  const supabase = await createClient()
  return unwrap<CardStockRow>(
    await supabase.rpc('link_card_stock_uid', {
      p_card_no: args.cardNo,
      p_card_uid: args.cardUid,
    })
  )
}

export async function assignCardStockToMember(args: {
  memberId: string
  cardNo: number
  cardUid?: string
  replace?: boolean
}) {
  const supabase = await createClient()
  return unwrap<MemberCardRow>(
    await supabase.rpc('assign_card_stock_to_member', {
      p_member_id: args.memberId,
      p_card_no: args.cardNo,
      ...(args.cardUid ? { p_card_uid: args.cardUid } : {}),
      p_replace: args.replace ?? false,
    })
  )
}

export async function setCardStockStatus(args: {
  cardNo: number
  status: CardStockStatus
  reason?: string
}) {
  const supabase = await createClient()
  return unwrap<CardStockRow>(
    await supabase.rpc('set_card_stock_status', {
      p_card_no: args.cardNo,
      p_status: args.status,
      ...(args.reason ? { p_reason: args.reason } : {}),
    })
  )
}

/**
 * Which printed cards a set of chip UIDs belong to, keyed by UID. Used to
 * label inbox taps "Card 0004 · ..." -- a tap from a numbered card is most of
 * what the desk sees once stock is in play.
 */
export async function findCardStockByUids(uids: string[]) {
  const found = new Map<string, { card_no: number; status: CardStockStatus }>()
  const unique = [...new Set(uids.filter(Boolean))]
  if (unique.length === 0) return found

  const supabase = await createClient()
  const rows =
    unwrap<{ card_uid: string | null; card_no: number; status: CardStockStatus }[]>(
      await supabase.from('card_stock').select('card_uid, card_no, status').in('card_uid', unique)
    ) ?? []

  for (const row of rows) {
    if (row.card_uid) found.set(row.card_uid, { card_no: row.card_no, status: row.status })
  }
  return found
}
