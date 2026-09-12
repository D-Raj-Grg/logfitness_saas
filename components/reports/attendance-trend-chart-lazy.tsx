'use client'

import dynamic from 'next/dynamic'

import { ChartSkeleton } from '@/components/app/skeletons'

/**
 * recharts is the single heaviest dependency in the console and it is used on
 * exactly one screen, below the controls and the summary. Loading it on demand
 * keeps it out of the initial bundle for /reports/attendance; the numbers in
 * the table underneath are the part people read first anyway.
 *
 * `ssr: false` needs a Client Component boundary, which is what this file is
 * for -- the page importing it stays a Server Component.
 */
export const AttendanceTrendChart = dynamic(
  () =>
    import('@/components/reports/attendance-trend-chart').then(
      (mod) => mod.AttendanceTrendChart
    ),
  { ssr: false, loading: () => <ChartSkeleton /> }
)
