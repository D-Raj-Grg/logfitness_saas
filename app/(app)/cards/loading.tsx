import {
  FiltersSkeleton,
  PageHeadingSkeleton,
  StatusTilesSkeleton,
  TableSkeleton,
} from '@/components/app/skeletons'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeadingSkeleton action />
      <StatusTilesSkeleton count={5} />
      <FiltersSkeleton controls={2} />
      <TableSkeleton rows={10} columns={6} />
    </div>
  )
}
