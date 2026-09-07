import type { ReportPeriod } from '@/lib/db/reports'

export type PeriodPreset = 'today' | '7d' | '30d' | 'month' | 'custom'

export type ResolvedPeriod = {
  from: string
  to: string
  groupBy: ReportPeriod
  preset: PeriodPreset
}

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  month: 'This month',
  custom: 'Custom range',
}

export const GROUP_LABELS: Record<ReportPeriod, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Reads the period out of the URL. Defaults to the last 30 days grouped by day
 * -- long enough to see a shape, short enough to read.
 *
 * The dates here only PROPOSE a range. Which business day a payment or a visit
 * belongs to is still decided in SQL by org_today(), per org, in the gym's own
 * timezone -- this never second-guesses that.
 */
export function resolvePeriod(
  searchParams: Record<string, string | string[] | undefined>
): ResolvedPeriod {
  const today = new Date()
  const todayIso = iso(today)

  const rawPreset = first(searchParams.period)
  const preset: PeriodPreset =
    rawPreset === 'today' || rawPreset === '7d' || rawPreset === 'month' || rawPreset === 'custom'
      ? rawPreset
      : rawPreset === '30d'
        ? '30d'
        : first(searchParams.from) || first(searchParams.to)
          ? 'custom'
          : '30d'

  const back = (days: number) => iso(new Date(today.getTime() - days * 86_400_000))

  let from: string
  let to = todayIso

  if (preset === 'custom') {
    const rawFrom = first(searchParams.from)
    const rawTo = first(searchParams.to)
    from = rawFrom && ISO_DATE.test(rawFrom) ? rawFrom : back(30)
    to = rawTo && ISO_DATE.test(rawTo) ? rawTo : todayIso
  } else if (preset === 'today') {
    from = todayIso
  } else if (preset === '7d') {
    from = back(6)
  } else if (preset === 'month') {
    from = iso(new Date(today.getFullYear(), today.getMonth(), 1))
  } else {
    from = back(29)
  }

  // A backwards range is a typo, not a question. Swap it rather than returning
  // an empty report the reader will read as "no takings".
  if (from > to) [from, to] = [to, from]

  const rawGroup = first(searchParams.group)
  const groupBy: ReportPeriod =
    rawGroup === 'week' || rawGroup === 'month' || rawGroup === 'day' ? rawGroup : 'day'

  return { from, to, groupBy, preset }
}
