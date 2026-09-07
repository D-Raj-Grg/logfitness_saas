import type { Database } from '@/lib/types/database'

type Org = Database['public']['Tables']['orgs']['Row']

/**
 * Money is stored as integer paisa. It is converted to a decimal exactly once,
 * here, at the render boundary -- never in queries, totals, or business logic.
 */
export function formatMoney(
  paisa: number,
  options: { currency?: string; withSymbol?: boolean } = {}
) {
  const { currency = 'NPR', withSymbol = true } = options

  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(paisa / 100)

  return withSymbol ? `${currency} ${formatted}` : formatted
}

/** Parses user input in rupees into the integer paisa the database stores. */
export function toPaisa(rupees: string | number) {
  const value = typeof rupees === 'string' ? Number(rupees.replace(/,/g, '')) : rupees

  if (!Number.isFinite(value)) {
    throw new Error(`Not a valid amount: ${rupees}`)
  }

  return Math.round(value * 100)
}

export const DEFAULT_TIMEZONE = 'Asia/Kathmandu'

export function formatDate(
  value: string | Date,
  timeZone: string = DEFAULT_TIMEZONE
) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(new Date(value))
}

export function formatDateTime(
  value: string | Date,
  timeZone: string = DEFAULT_TIMEZONE
) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(value))
}

export function formatTime(
  value: string | Date,
  timeZone: string = DEFAULT_TIMEZONE
) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(value))
}

/** Whole days from today until `value`; negative once the date has passed. */
export function daysUntil(value: string | Date, timeZone: string = DEFAULT_TIMEZONE) {
  const dayInMs = 24 * 60 * 60 * 1000
  const startOfDay = (date: Date) =>
    new Date(date.toLocaleDateString('en-CA', { timeZone })).getTime()

  return Math.round((startOfDay(new Date(value)) - startOfDay(new Date())) / dayInMs)
}

/**
 * Calendar arithmetic on a YYYY-MM-DD string, free of timezone drift: the dates
 * the database stores are plain days, and putting one through a local Date is
 * how "07 Sept" becomes "06 Sept" in the evening.
 */
export function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/** Whole days from one YYYY-MM-DD to another; negative when it runs backwards. */
export function daysBetween(fromIsoDate: string, toIsoDate: string) {
  const asUtc = (value: string) => {
    const [year, month, day] = value.split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((asUtc(toIsoDate) - asUtc(fromIsoDate)) / 86400000)
}

export function orgFormatters(org: Pick<Org, 'currency' | 'timezone'>) {
  return {
    money: (paisa: number) => formatMoney(paisa, { currency: org.currency }),
    date: (value: string | Date) => formatDate(value, org.timezone),
    dateTime: (value: string | Date) => formatDateTime(value, org.timezone),
    time: (value: string | Date) => formatTime(value, org.timezone),
  }
}
