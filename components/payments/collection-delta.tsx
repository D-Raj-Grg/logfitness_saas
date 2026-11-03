import { formatMoney } from '@/lib/format'

/**
 * One tile's comparison with the day before.
 *
 * Deliberately not colour-coded by direction. More cash than yesterday is
 * good; more refunds than yesterday is not; and a component handed two numbers
 * cannot tell which it is looking at. An arrow and a number say what happened
 * and let the reader judge it -- painting half of them green would be wrong
 * half the time.
 */
export function CollectionDelta({
  current,
  previous,
  kind = 'money',
  against = 'yesterday',
}: {
  current: number
  previous: number
  kind?: 'money' | 'count'
  /** What `previous` is: "yesterday" for one day, "previous 7 days" for a range. */
  against?: string
}) {
  const show = (value: number) =>
    kind === 'money' ? formatMoney(Math.abs(value)) : String(Math.abs(value))

  const when = against === 'yesterday' ? against : `in the ${against}`

  if (previous === 0 && current === 0) {
    return <span className="text-xs text-muted-foreground">Nothing {when} either</span>
  }

  if (previous === 0) {
    return <span className="text-xs text-muted-foreground">Nothing {when}</span>
  }

  const change = current - previous

  if (change === 0) {
    return <span className="text-xs text-muted-foreground">Same as {against}</span>
  }

  // Against a negative previous day -- a day that refunded more than it took --
  // a percentage is arithmetic rather than meaning, so the bare figure stands.
  const pct = previous > 0 ? Math.round((change / previous) * 100) : null

  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {change > 0 ? '↑' : '↓'} {show(change)}
      {pct !== null ? ` (${Math.abs(pct)}%)` : ''} vs {against}
    </span>
  )
}
