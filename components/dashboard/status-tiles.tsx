import { StatTile } from '@/components/app/stat-tile'
import type { orgSnapshot } from '@/lib/db/reports'
import { formatMoney } from '@/lib/format'

type SnapshotRow = Awaited<ReturnType<typeof orgSnapshot>>[number]

/**
 * The dashboard's headline numbers, from the totals row of org_snapshot.
 * Every tile is a link into the screen that already shows that detail, so the
 * number is also the way to act on it.
 */
export function StatusTiles({
  snapshot,
  compact = false,
}: {
  /** The totals row (branch_id null). Undefined only while the aggregate is
   * out of scope entirely, which does not happen for a signed-in caller. */
  snapshot?: SnapshotRow
  /** Trainers only need to know who is in and who is about to lapse. */
  compact?: boolean
}) {
  if (!snapshot) return null

  const tiles = [
    {
      key: 'active',
      label: 'Active members',
      value: String(snapshot.active_members),
      href: '/members?status=active',
      className: '',
    },
    {
      key: 'expiring',
      label: 'Expiring in 7 days',
      value: String(snapshot.expiring_7d),
      href: '/members?status=expiring',
      className: 'text-amber-700 dark:text-amber-400',
    },
    {
      key: 'checkins',
      label: 'Check-ins today',
      value: String(snapshot.check_ins_today),
      href: '/check-in',
      className: '',
    },
    {
      key: 'collection',
      label: "Today's collection",
      value: formatMoney(snapshot.collected_today_paisa),
      href: '/payments?view=collection',
      hint: 'Net of refunds and reversals',
      className: snapshot.collected_today_paisa < 0 ? 'text-destructive' : '',
    },
    {
      key: 'dues',
      label: 'Dues outstanding',
      value: formatMoney(snapshot.dues_paisa),
      href: '/payments?view=arrears',
      className: snapshot.dues_paisa > 0 ? 'text-destructive' : '',
    },
  ]

  const visible = compact
    ? tiles.filter((tile) => tile.key === 'active' || tile.key === 'expiring')
    : tiles

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {visible.map((tile) => (
        <StatTile
          key={tile.key}
          label={tile.label}
          value={tile.value}
          href={tile.href}
          hint={'hint' in tile ? tile.hint : undefined}
          className={tile.className}
        />
      ))}
    </div>
  )
}
