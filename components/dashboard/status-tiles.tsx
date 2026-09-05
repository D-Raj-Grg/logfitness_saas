import Link from 'next/link'

import { Card, CardContent } from '@/components/ui/card'
import type { memberStatusCounts } from '@/lib/db/members'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'

type Counts = Awaited<ReturnType<typeof memberStatusCounts>>

type Tile = {
  key: keyof Counts
  label: string
  href: string
  tone: 'default' | 'warn' | 'bad' | 'muted'
}

const TILES: Tile[] = [
  { key: 'active', label: 'Active', href: '/members?status=active', tone: 'default' },
  { key: 'expiring', label: 'Expiring in 7 days', href: '/members?status=expiring', tone: 'warn' },
  { key: 'expired', label: 'Expired', href: '/members?status=expired', tone: 'bad' },
  { key: 'frozen', label: 'Frozen', href: '/members?status=frozen', tone: 'muted' },
  { key: 'withDues', label: 'With dues', href: '/members?status=dues', tone: 'bad' },
]

const TONE_CLASS: Record<Tile['tone'], string> = {
  default: '',
  warn: 'text-amber-700 dark:text-amber-400',
  bad: 'text-destructive',
  muted: 'text-muted-foreground',
}

function StatTile({
  label,
  value,
  href,
  hint,
  className,
}: {
  label: string
  value: string
  href: string
  hint?: string
  className?: string
}) {
  return (
    <Link href={href} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
      <Card className="h-full transition-colors hover:bg-muted/40">
        <CardContent className="flex flex-col gap-1 py-4">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {label}
          </span>
          <span className={cn('text-2xl font-semibold tabular-nums', className)}>{value}</span>
          {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
        </CardContent>
      </Card>
    </Link>
  )
}

/**
 * The dashboard's headline numbers. Every tile is a link into the member list
 * already filtered to that group, so the number is also the way to act on it.
 */
export function StatusTiles({
  counts,
  collectionPaisa,
  compact = false,
}: {
  counts: Counts
  /** Net cash in today; omitted for roles that do not handle money. */
  collectionPaisa?: number
  /** Trainers only need to know who is in and who is about to lapse. */
  compact?: boolean
}) {
  const tiles = compact
    ? TILES.filter((tile) => tile.key === 'active' || tile.key === 'expiring')
    : TILES

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => (
        <StatTile
          key={tile.key}
          label={tile.label}
          value={String(counts[tile.key])}
          href={tile.href}
          className={TONE_CLASS[tile.tone]}
        />
      ))}
      {collectionPaisa !== undefined ? (
        <StatTile
          label="Today's collection"
          value={formatMoney(collectionPaisa)}
          href="/payments"
          hint="Net of refunds"
          className={collectionPaisa < 0 ? 'text-destructive' : ''}
        />
      ) : null}
    </div>
  )
}
