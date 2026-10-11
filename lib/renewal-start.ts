import { addDays } from '@/lib/format'

/**
 * The day a renewal should continue from when the last plan has already ended.
 * A member who kept training after expiry owes those days, so the default is
 * the day after the old end, not today. Null when there is nothing to
 * continue from: no history, a plan still running, or one open-ended.
 */
export function continueFromDate(lastEndDate: string | null, today: string) {
  if (!lastEndDate || lastEndDate >= today) return null
  return addDays(lastEndDate, 1)
}
