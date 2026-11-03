import { CardSkeleton, TableSkeleton } from '@/components/app/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

/** The staff screen: identity block, details, then the activity tabs. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <Skeleton className="size-14 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-7 w-56 rounded-md" />
          <Skeleton className="h-4 w-72 rounded-md" />
        </div>
        <Skeleton className="h-9 w-48 rounded-lg" />
      </div>
      <CardSkeleton lines={3} />
      <Skeleton className="h-9 w-80 rounded-full" />
      <TableSkeleton rows={6} columns={6} />
    </div>
  )
}
