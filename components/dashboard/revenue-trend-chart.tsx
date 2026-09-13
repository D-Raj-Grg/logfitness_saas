'use client'

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { formatDate, formatMoney } from '@/lib/format'

export type RevenuePoint = { period: string; net_paisa: number }

const chartConfig = {
  net_paisa: { label: 'Net collected', color: 'var(--chart-1)' },
} satisfies ChartConfig

/** Rupees, short, for an axis tick -- `NPR 1,20,000` is too wide to repeat. */
function compactRupees(paisa: number) {
  return new Intl.NumberFormat('en-IN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(paisa / 100)
}

/**
 * Net takings per day. Net rather than gross because the tile above it is net
 * too, and a day where a big refund went out is exactly the day the dashboard
 * should not be showing a record.
 */
export function RevenueTrendChart({ points }: { points: RevenuePoint[] }) {
  const dot = points.length === 1

  return (
    <ChartContainer config={chartConfig} className="h-[150px] w-full">
      <AreaChart data={points} margin={{ left: 4, right: 8, top: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="period"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={(value: string) => formatDate(value).slice(0, 6)}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={44}
          tickFormatter={(value: number) => compactRupees(value)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(value) => formatDate(String(value))}
              formatter={(value) => formatMoney(Number(value))}
            />
          }
        />
        <defs>
          <linearGradient id="dashboard-revenue-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-net_paisa)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-net_paisa)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <Area
          dataKey="net_paisa"
          type="monotone"
          stroke="var(--color-net_paisa)"
          strokeWidth={2}
          fill="url(#dashboard-revenue-fill)"
          dot={dot}
        />
      </AreaChart>
    </ChartContainer>
  )
}
