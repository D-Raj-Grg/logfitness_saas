import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

/**
 * Shared loading shapes.
 *
 * A skeleton is only worth showing if it occupies the same box the real content
 * will: same grid, same border, same row height. Anything else swaps one layout
 * for another when the data lands, which reads as a flash rather than a load.
 * So these mirror the live components they stand in for -- change one, change
 * the other.
 */

/** Matches the `h1` + sub-line block every screen opens with. */
export function PageHeadingSkeleton({ action = false }: { action?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-44 rounded-md" />
        <Skeleton className="h-4 w-72 rounded-md" />
      </div>
      {action ? <Skeleton className="h-9 w-36 rounded-lg" /> : null}
    </div>
  )
}

/**
 * Mirrors `StatusTiles` -- same grid at every breakpoint, so the tiles do not
 * reflow when the snapshot arrives.
 */
export function StatusTilesSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className="h-full">
          <CardContent className="flex flex-col gap-1 py-4">
            <Skeleton className="h-3 w-24 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/**
 * Mirrors the bordered list views. `columns` should match the real header count
 * so the column rhythm is already right when rows replace the skeleton.
 */
export function TableSkeleton({
  rows = 8,
  columns = 6,
  className,
}: {
  rows?: number
  columns?: number
  className?: string
}) {
  return (
    <div className={cn('overflow-x-auto rounded-lg border', className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {Array.from({ length: columns }, (_, i) => (
              <TableHead key={i}>
                <Skeleton className="h-4 w-20 rounded-md" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }, (_, r) => (
            <TableRow key={r}>
              {Array.from({ length: columns }, (_, c) => (
                <TableCell key={c}>
                  {/* The first column carries the avatar/serial, so it reads
                      narrower than the name column beside it. */}
                  <Skeleton
                    className={cn(
                      'h-4 rounded-md',
                      c === 0 ? 'w-8' : c === 1 ? 'w-36' : 'w-24'
                    )}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** The search + filter bar that sits above most list views. */
export function FiltersSkeleton({ controls = 3 }: { controls?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Skeleton className="h-9 w-full max-w-xs rounded-lg" />
      {Array.from({ length: controls - 1 }, (_, i) => (
        <Skeleton key={i} className="h-9 w-32 rounded-lg" />
      ))}
    </div>
  )
}

/** A single bordered panel -- report summaries, settings cards. */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-5">
        <Skeleton className="h-5 w-40 rounded-md" />
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-4 w-full rounded-md" />
        ))}
      </CardContent>
    </Card>
  )
}

/** Report screens: a chart well above the detail table. */
export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-lg border p-4', className)}>
      <Skeleton className="h-4 w-32 rounded-md" />
      <Skeleton className="mt-4 h-56 w-full rounded-lg" />
    </div>
  )
}
