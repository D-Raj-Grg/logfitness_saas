import { DEFAULT_TIMEZONE, addDays } from '@/lib/format'
import { isRangeNotSatisfiable, lastPageFor } from '@/lib/db/paging'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type PaymentKind = Database['public']['Enums']['payment_kind']
export type PaymentMethod = Database['public']['Enums']['payment_method']

/**
 * The instant a business day starts, as an ISO string with the gym's own UTC
 * offset. paid_at is a timestamptz, and "the 3rd" means the gym's 3rd, not
 * UTC's -- a 10pm payment belongs to that evening. Nepal has no daylight
 * saving, so the offset read here is the offset for the whole day.
 */
export function dayStart(isoDate: string, timeZone: string = DEFAULT_TIMEZONE) {
  const probe = new Date(`${isoDate}T12:00:00Z`)
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(probe)
    .find((item) => item.type === 'timeZoneName')?.value
  // "GMT+05:45" -> "+05:45"; plain "GMT" means UTC.
  const offset = part && part !== 'GMT' ? part.replace('GMT', '') : '+00:00'
  return `${isoDate}T00:00:00${offset}`
}

export type CollectedPaymentRow = {
  id: string
  paid_at: string
  kind: PaymentKind
  method: PaymentMethod
  amount_paisa: number
  reference_no: string | null
  member_id: string
  branch_id: string
  members: { full_name: string; member_code: string } | null
  branches: { name: string } | null
}

/**
 * Payments this staff member took in [from, to], newest first, one page at a
 * time, plus the totals for the WHOLE range rather than the page. Totals are
 * summed here from (kind, amount) pairs capped at TOTALS_LIMIT rows; a range
 * that hits the cap is flagged so the screen can say the totals are partial
 * instead of quietly under-counting.
 */
export const TOTALS_LIMIT = 5000

export async function listPaymentsCollectedBy(args: {
  staffId: string
  branchIds: string[] | null
  from: string
  to: string
  page: number
  pageSize: number
}) {
  const supabase = await createClient()
  const start = dayStart(args.from)
  const end = dayStart(addDays(args.to, 1))

  // A function so a page past the end can be re-asked for the last real page.
  const buildRows = (page: number) => {
    let query = supabase
      .from('payments')
      .select(
        'id, paid_at, kind, method, amount_paisa, reference_no, member_id, branch_id, members(full_name, member_code), branches(name)',
        { count: 'exact' }
      )
      .eq('collected_by', args.staffId)
      .gte('paid_at', start)
      .lt('paid_at', end)
      .order('paid_at', { ascending: false })
      .order('id', { ascending: false })
      .range((page - 1) * args.pageSize, page * args.pageSize - 1)
    if (args.branchIds) query = query.in('branch_id', args.branchIds)
    return query
  }

  let totalsQuery = supabase
    .from('payments')
    .select('kind, amount_paisa')
    .eq('collected_by', args.staffId)
    .gte('paid_at', start)
    .lt('paid_at', end)
    .limit(TOTALS_LIMIT)

  if (args.branchIds) totalsQuery = totalsQuery.in('branch_id', args.branchIds)

  let page = args.page
  const [firstRows, totals] = await Promise.all([buildRows(page), totalsQuery])
  let rows = firstRows
  if (isRangeNotSatisfiable(rows.error)) {
    const probe = await buildRows(1)
    if (probe.error) throw probe.error
    page = lastPageFor(probe.count ?? 0, args.pageSize)
    rows = await buildRows(page)
  }
  if (rows.error) throw rows.error
  if (totals.error) throw totals.error

  let gross = 0
  let refunds = 0
  let reversals = 0
  for (const row of totals.data ?? []) {
    if (row.kind === 'payment') gross += row.amount_paisa
    // Refunds and reversals are stored negative.
    else if (row.kind === 'refund') refunds += Math.abs(row.amount_paisa)
    else reversals += Math.abs(row.amount_paisa)
  }

  return {
    rows: (rows.data ?? []) as unknown as CollectedPaymentRow[],
    total: rows.count ?? 0,
    page,
    sums: { gross, refunds, reversals, net: gross - refunds - reversals },
    totalsPartial: (totals.data?.length ?? 0) >= TOTALS_LIMIT,
  }
}

export type TrainerClassRow = {
  id: string
  starts_at: string
  ends_at: string
  capacity: number
  booked_count: number
  status: Database['public']['Enums']['class_session_status']
  branch_id: string
  classes: { name: string; room: string | null } | null
}

/** Classes this person taught or is due to teach in [from, to], soonest first. */
export async function listClassesTaughtBy(args: {
  staffId: string
  branchIds: string[] | null
  from: string
  to: string
}) {
  const supabase = await createClient()

  let query = supabase
    .from('class_sessions')
    .select('id, starts_at, ends_at, capacity, booked_count, status, branch_id, classes(name, room)')
    .eq('trainer_id', args.staffId)
    .gte('starts_at', dayStart(args.from))
    .lt('starts_at', dayStart(addDays(args.to, 1)))
    .order('starts_at', { ascending: false })
    .limit(200)

  if (args.branchIds) query = query.in('branch_id', args.branchIds)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as unknown as TrainerClassRow[]
}

/** Whether this person has ever been the trainer on a class or PT session. */
export async function hasTrainerWork(staffId: string) {
  const supabase = await createClient()
  const [classes, pt] = await Promise.all([
    supabase
      .from('class_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('trainer_id', staffId),
    supabase
      .from('pt_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('trainer_id', staffId),
  ])
  if (classes.error) throw classes.error
  if (pt.error) throw pt.error
  return (classes.count ?? 0) + (pt.count ?? 0) > 0
}
