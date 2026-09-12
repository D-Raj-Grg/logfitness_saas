import {
  FiltersSkeleton,
  PageHeadingSkeleton,
  TableSkeleton,
} from '@/components/app/skeletons'

/**
 * Covers the reports index and any report without a closer fallback. Every
 * report screen opens with the same period/branch controls above one table.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeadingSkeleton />
      <FiltersSkeleton controls={3} />
      <TableSkeleton rows={8} columns={6} />
    </div>
  )
}
