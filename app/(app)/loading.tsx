import {
  PageHeadingSkeleton,
  StatusTilesSkeleton,
  TableSkeleton,
} from '@/components/app/skeletons'

/**
 * The dashboard's fallback. Every other segment under (app) carries its own
 * loading.tsx, so this does not need to be a generic shape -- it can match the
 * tiles the snapshot actually renders.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeadingSkeleton />
      <StatusTilesSkeleton />
      <TableSkeleton rows={4} columns={6} />
    </div>
  )
}
