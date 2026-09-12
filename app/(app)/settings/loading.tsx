import { CardSkeleton, PageHeadingSkeleton } from '@/components/app/skeletons'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeadingSkeleton />
      <CardSkeleton lines={4} />
      <CardSkeleton lines={3} />
    </div>
  )
}
