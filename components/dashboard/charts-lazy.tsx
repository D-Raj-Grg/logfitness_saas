'use client'

import dynamic from 'next/dynamic'

import { Skeleton } from '@/components/ui/skeleton'

/**
 * recharts is the heaviest dependency in the console. The dashboard is the
 * first screen every shift opens, so the plots load after the tiles rather
 * than inside the first bundle -- the numbers above them are what the desk
 * reads first anyway.
 *
 * `ssr: false` needs a Client Component boundary, which is what this file is
 * for: the dashboard page itself stays a Server Component.
 */
function PlotSkeleton() {
  return <Skeleton className="h-[220px] w-full rounded-lg" />
}

export const RevenueTrendChart = dynamic(
  () =>
    import('@/components/dashboard/revenue-trend-chart').then((mod) => mod.RevenueTrendChart),
  { ssr: false, loading: PlotSkeleton }
)

export const AttendanceMiniChart = dynamic(
  () =>
    import('@/components/dashboard/attendance-mini-chart').then(
      (mod) => mod.AttendanceMiniChart
    ),
  { ssr: false, loading: PlotSkeleton }
)

export const MovementChart = dynamic(
  () => import('@/components/dashboard/movement-chart').then((mod) => mod.MovementChart),
  { ssr: false, loading: PlotSkeleton }
)
