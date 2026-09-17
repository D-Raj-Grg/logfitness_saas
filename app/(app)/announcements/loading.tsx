import { PageHeadingSkeleton, TableSkeleton } from '@/components/app/skeletons'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeadingSkeleton />
      <TableSkeleton rows={6} columns={5} />
    </div>
  )
}
