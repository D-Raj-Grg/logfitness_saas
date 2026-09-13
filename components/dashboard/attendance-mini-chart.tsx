'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { formatDate } from '@/lib/format'

export type AttendancePoint = {
  period: string
  check_ins: number
  distinct_members: number
}

const chartConfig = {
  check_ins: { label: 'Check-ins', color: 'var(--chart-2)' },
  distinct_members: { label: 'People', color: 'var(--chart-1)' },
} satisfies ChartConfig

/**
 * Daily footfall. Bars rather than lines: a gym's week has a shape (quiet
 * Saturdays, busy Mondays) that reads better as discrete days, and a closed day
 * should look like a gap, not like a line sagging through zero.
 */
export function AttendanceMiniChart({ points }: { points: AttendancePoint[] }) {
  return (
    <ChartContainer config={chartConfig} className="h-[150px] w-full">
      <BarChart data={points} margin={{ left: 4, right: 8, top: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="period"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={(value: string) => formatDate(value).slice(0, 6)}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={32} allowDecimals={false} />
        <ChartTooltip
          content={
            <ChartTooltipContent labelFormatter={(value) => formatDate(String(value))} />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="check_ins" fill="var(--color-check_ins)" radius={[3, 3, 0, 0]} />
        <Bar dataKey="distinct_members" fill="var(--color-distinct_members)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ChartContainer>
  )
}
