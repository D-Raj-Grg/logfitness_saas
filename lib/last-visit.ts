import { daysBetween } from '@/lib/format'

/**
 * How long ago a member last came, in words a desk can read at a glance.
 *
 * Both dates are plain YYYY-MM-DD calendar days in the gym's own timezone
 * (`last_visit_on` is the attendance row's org-local `attended_on`, and `today`
 * comes from todayInTimezone), so the difference is whole days with no
 * time-of-day or browser-timezone drift. Call this on the server.
 */
export function lastVisitLabel(lastVisitOn: string | null, today: string) {
  if (!lastVisitOn) return { label: 'Never', never: true }

  const days = daysBetween(lastVisitOn, today)
  if (days <= 0) return { label: 'Today', never: false }
  if (days === 1) return { label: 'Yesterday', never: false }
  return { label: `${days} days ago`, never: false }
}
