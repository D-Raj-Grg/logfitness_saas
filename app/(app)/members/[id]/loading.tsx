import {
  CardSkeleton,
  PageHeadingSkeleton,
  TableSkeleton,
} from '@/components/app/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The member profile: identity block, then the membership/payment history.
 * The avatar is a circle here because a rounded rectangle in its place is the
 * kind of mismatch people notice.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <Skeleton className="size-16 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-7 w-56 rounded-md" />
          <Skeleton className="h-4 w-40 rounded-md" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CardSkeleton lines={4} />
        <CardSkeleton lines={4} />
      </div>
      <PageHeadingSkeleton />
      <TableSkeleton rows={6} columns={6} />
    </div>
  )
}
