import Link from 'next/link'

import {
  ARREARS_BUCKETS,
  isArrearsBucket,
  type ArrearsBucket,
} from '@/components/payments/arrears-buckets'
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
import type { arrearsReport } from '@/lib/db/payments'
import { formatDate, formatMoney } from '@/lib/format'

type Row = Awaited<ReturnType<typeof arrearsReport>>[number]

/** Older debt is less likely to come in, so the tone escalates with age. */
const BUCKET_TONE: Record<ArrearsBucket, { variant: 'outline' | 'secondary' | 'destructive'; className?: string }> = {
  '0-30': { variant: 'outline' },
  '31-60': { variant: 'secondary', className: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' },
  '61-90': { variant: 'destructive' },
  '90+': { variant: 'destructive', className: 'bg-destructive text-white dark:bg-destructive' },
}

export function BucketBadge({ bucket }: { bucket: string }) {
  const tone = isArrearsBucket(bucket) ? BUCKET_TONE[bucket] : BUCKET_TONE['0-30']
  return (
    <Badge variant={tone.variant} className={tone.className}>
      {bucket} days
    </Badge>
  )
}

export function ArrearsTable({
  rows,
  allRows,
}: {
  /** Rows after the bucket filter -- what the table shows. */
  rows: Row[]
  /** Rows before it -- what the summary tiles count. */
  allRows: Row[]
}) {
  const totalOutstanding = allRows.reduce((sum, row) => sum + row.due_paisa, 0)
  const bucketCounts = Object.fromEntries(
    ARREARS_BUCKETS.map((bucket) => [
      bucket,
      allRows.filter((row) => row.bucket === bucket).length,
    ])
  ) as Record<ArrearsBucket, number>

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="flex flex-col gap-1 py-4">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Total outstanding
            </span>
            <span className="text-2xl font-semibold text-destructive tabular-nums">
              {formatMoney(totalOutstanding)}
            </span>
            <span className="text-xs text-muted-foreground">
              {allRows.length} member{allRows.length === 1 ? '' : 's'}
            </span>
          </CardContent>
        </Card>
        {ARREARS_BUCKETS.map((bucket) => (
          <Card key={bucket}>
            <CardContent className="flex flex-col gap-1 py-4">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {bucket} days
              </span>
              <span className="text-2xl font-semibold tabular-nums">{bucketCounts[bucket]}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nobody owes anything here.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Oldest due</TableHead>
              <TableHead className="text-right">Age</TableHead>
              <TableHead>Bucket</TableHead>
              <TableHead className="text-right">Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.member_id}>
                <TableCell>
                  <Link href={`/members/${row.member_id}`} className="font-medium hover:underline">
                    {row.full_name}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{row.member_code}</span>
                </TableCell>
                <TableCell className="tabular-nums">{row.phone}</TableCell>
                <TableCell>{row.home_branch_name}</TableCell>
                <TableCell>{formatDate(row.oldest_due_on)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.age_days} day{row.age_days === 1 ? '' : 's'}
                </TableCell>
                <TableCell>
                  <BucketBadge bucket={row.bucket} />
                </TableCell>
                <TableCell className="text-right font-semibold text-destructive tabular-nums">
                  {formatMoney(row.due_paisa)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
