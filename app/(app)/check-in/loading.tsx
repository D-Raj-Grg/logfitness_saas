import {
  PageHeadingSkeleton,
  StatusTilesSkeleton,
  TableSkeleton,
} from '@/components/app/skeletons'

/**
 * Check-in opens with the search console and the who-is-in list. The console is
 * a client component that renders immediately, so the fallback only stands in
 * for the day summary and the log.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeadingSkeleton />
      <StatusTilesSkeleton count={3} />
      <TableSkeleton rows={8} columns={6} />
    </div>
  )
}
