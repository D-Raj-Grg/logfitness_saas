import {
  ChartSkeleton,
  FiltersSkeleton,
  PageHeadingSkeleton,
  TableSkeleton,
} from '@/components/app/skeletons'

/** The one report that leads with a trend chart. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeadingSkeleton />
      <FiltersSkeleton controls={3} />
      <ChartSkeleton />
      <TableSkeleton rows={8} columns={5} />
    </div>
  )
}
