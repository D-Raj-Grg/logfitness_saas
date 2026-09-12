import {
  FiltersSkeleton,
  PageHeadingSkeleton,
  TableSkeleton,
} from '@/components/app/skeletons'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeadingSkeleton />
      <FiltersSkeleton controls={2} />
      <TableSkeleton rows={8} columns={6} />
    </div>
  )
}
