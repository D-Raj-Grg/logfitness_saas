'use client'

import { Line, LineChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { formatDate } from '@/lib/format'

export type AttendanceTrendPoint = {
  period: string
  check_ins: number
  distinct_members: number
}

const chartConfig = {
  check_ins: { label: 'Check-ins', color: 'var(--chart-1)' },
  distinct_members: { label: 'Distinct members', color: 'var(--chart-2)' },
} satisfies ChartConfig

/**
 * One line per period across the whole scope: check-ins can be inflated by a
 * single member training twice a day, distinct_members cannot, so both lines
 * stay on screen together rather than picking one.
 */
export function AttendanceTrendChart({ points }: { points: AttendanceTrendPoint[] }) {
  // Multiple branches contribute rows per period; the chart reads one line per
  // metric across the scope, so periods are summed across branches here.
  const byPeriod = new Map<string, AttendanceTrendPoint>()
  for (const point of points) {
    const existing = byPeriod.get(point.period)
    if (existing) {
      existing.check_ins += point.check_ins
      existing.distinct_members += point.distinct_members
    } else {
      byPeriod.set(point.period, { ...point })
    }
  }
  const data = Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period))

  // A line between one point and nothing draws nothing. A one-day custom range,
  // or a month grouping over a short window, is a real thing to ask for -- and a
  // blank plot above a populated table reads as missing data rather than as one
  // data point. Show the marker when there is only one.
  const dot = data.length === 1

  return (
    <ChartContainer config={chartConfig} className="h-[280px] w-full">
      <LineChart data={data} margin={{ left: 12, right: 12 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="period"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(value: string) => formatDate(value)}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
        <ChartTooltip
          content={
            <ChartTooltipContent labelFormatter={(value) => formatDate(String(value))} />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          dataKey="check_ins"
          type="monotone"
          stroke="var(--color-check_ins)"
          strokeWidth={2}
          dot={dot}
        />
        <Line
          dataKey="distinct_members"
          type="monotone"
          stroke="var(--color-distinct_members)"
          strokeWidth={2}
          dot={dot}
        />
      </LineChart>
    </ChartContainer>
  )
}
