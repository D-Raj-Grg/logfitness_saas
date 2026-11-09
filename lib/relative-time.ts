/**
 * "just now", "25 min ago", "3 hours ago", "2 days ago". Coarse on purpose:
 * it says how long a member has been waiting, not when the clock struck.
 * Anything older than a month falls back to the caller's date formatter.
 */
export function relativeTimeLabel(value: string | Date, now: Date = new Date()) {
  const diffMs = now.getTime() - new Date(value).getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.round(hours / 24)
  if (days < 31) return days === 1 ? 'yesterday' : `${days} days ago`
  return null
}
