import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ABSENCE_BANDS, type AbsenceBand } from '@/lib/attendance'
import type { absentMembers } from '@/lib/db/attendance'
import { formatDate, formatMoney } from '@/lib/format'

type RpcRow = Awaited<ReturnType<typeof absentMembers>>[number]

/**
 * Postgres cannot prove a set-returning function's columns are non-null, so the
 * generated type widens nothing. These three genuinely are nullable: somebody
 * who never came has no last visit, and somebody between plans has no end date.
 */
export type AbsentRow = Omit<
  RpcRow,
  'last_seen_on' | 'membership_end_date' | 'days_to_expiry'
> & {
  last_seen_on: string | null
  membership_end_date: string | null
  days_to_expiry: number | null
}

function isAbsenceBand(value: string): value is AbsenceBand {
  return (ABSENCE_BANDS as readonly string[]).includes(value)
}

/** The longer they have been gone, the closer they are to never coming back. */
const BAND_TONE: Record<
  AbsenceBand,
  { variant: 'outline' | 'secondary' | 'destructive'; className?: string }
> = {
  '14-29 days': { variant: 'outline' },
  '30-59 days': {
    variant: 'secondary',
    className: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  },
  '60+ days': { variant: 'destructive' },
}

export function BandBadge({ band }: { band: string }) {
  const tone = isAbsenceBand(band) ? BAND_TONE[band] : BAND_TONE['14-29 days']
  return (
    <Badge variant={tone.variant} className={tone.className}>
      {band}
    </Badge>
  )
}

export function AbsentMembersTable({
  rows,
  allRows,
  branchId,
  minDays,
  band,
}: {
  /** Rows after the band filter -- what the table shows. */
  rows: AbsentRow[]
  /** Rows before it -- what the summary tiles count. */
  allRows: AbsentRow[]
  branchId: string | null
  minDays: number
  band: AbsenceBand | null
}) {
  /** Tiles are the fastest way to slice the list, so each one is a link. */
  function href(nextBand: AbsenceBand | null) {
    const params = new URLSearchParams()
    if (branchId) params.set('branch', branchId)
    params.set('minDays', String(minDays))
    if (nextBand) params.set('band', nextBand)
    return `/reports/absent?${params.toString()}`
  }

  const neverVisited = allRows.filter((row) => !row.ever_visited).length
  const bandCounts = Object.fromEntries(
    ABSENCE_BANDS.map((value) => [
      value,
      allRows.filter((row) => row.band === value).length,
    ])
  ) as Record<AbsenceBand, number>

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 break-inside-avoid sm:grid-cols-2 lg:grid-cols-5">
        <Tile
          label="Away 14+ days"
          value={allRows.length}
          href={href(null)}
          active={band === null}
          hint={`${allRows.length === 1 ? 'member' : 'members'} to call`}
        />
        {ABSENCE_BANDS.map((value) => (
          <Tile
            key={value}
            label={value}
            value={bandCounts[value]}
            href={href(value)}
            active={band === value}
          />
        ))}
        <Card>
          <CardContent className="flex flex-col gap-1 py-4">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Never visited
            </span>
            <span className="text-2xl font-semibold tabular-nums">{neverVisited}</span>
            <span className="text-xs text-muted-foreground">Joined but never came in</span>
          </CardContent>
        </Card>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nobody has been away that long.
        </p>
      ) : (
        <div className="break-inside-avoid">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Home branch</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead className="text-right">Days absent</TableHead>
                <TableHead>Membership ends</TableHead>
                <TableHead className="text-right">Dues</TableHead>
                <TableHead>Band</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.member_id}>
                  <TableCell>
                    <Link
                      href={`/members/${row.member_id}`}
                      className="font-medium hover:underline"
                    >
                      {row.full_name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {row.member_code}
                    </span>
                  </TableCell>
                  <TableCell>
                    {/* This report exists to be phoned through. */}
                    <a href={`tel:${row.phone}`} className="tabular-nums hover:underline">
                      {row.phone}
                    </a>
                  </TableCell>
                  <TableCell>{row.home_branch_name}</TableCell>
                  <TableCell>
                    {row.last_seen_on ? (
                      formatDate(row.last_seen_on)
                    ) : (
                      <span className="text-muted-foreground">Never</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {row.days_absent}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {row.membership_end_date ? (
                      formatDate(row.membership_end_date)
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </TableCell>
                  <TableCell
                    className={
                      row.due_paisa > 0
                        ? 'text-right font-semibold text-destructive tabular-nums'
                        : 'text-right text-muted-foreground tabular-nums'
                    }
                  >
                    {formatMoney(row.due_paisa)}
                  </TableCell>
                  <TableCell>
                    <BandBadge band={row.band} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function Tile({
  label,
  value,
  href,
  active,
  hint,
}: {
  label: string
  value: number
  href: string
  active: boolean
  hint?: string
}) {
  return (
    <Link href={href} className="rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
      <Card
        className={
          active
            ? 'border-primary transition-colors'
            : 'transition-colors hover:border-primary/50'
        }
      >
        <CardContent className="flex flex-col gap-1 py-4">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {label}
          </span>
          <span className="text-2xl font-semibold tabular-nums">{value}</span>
          {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
        </CardContent>
      </Card>
    </Link>
  )
}
