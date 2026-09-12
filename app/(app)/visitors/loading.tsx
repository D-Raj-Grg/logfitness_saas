import {
  FiltersSkeleton,
  PageHeadingSkeleton,
  TableSkeleton,
} from '@/components/app/skeletons'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeadingSkeleton action />
      <FiltersSkeleton controls={2} />
      <TableSkeleton rows={8} columns={9} />
    </div>
  )
}
