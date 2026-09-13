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

export type MovementPoint = {
  period: string
  new_members: number
  renewals: number
  /** Kept positive in the data and drawn downward, so the axis stays honest. */
  expiries: number
}

const chartConfig = {
  new_members: { label: 'New', color: 'var(--chart-1)' },
  renewals: { label: 'Renewed', color: 'var(--chart-2)' },
  lost: { label: 'Expired', color: 'var(--chart-5)' },
} satisfies ChartConfig

/** `2026-09-01` -> `Sep`. Month grouping returns the first of the month. */
function monthLabel(value: string) {
  return new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(new Date(value))
}

/**
 * Members gained above the line, members lost below it. Stacking new and
 * renewed together answers "did the gym grow" in one glance: if the bar above
 * is shorter than the bar below, it shrank that month however good the sales
 * number looked on its own.
 */
export function MovementChart({ points }: { points: MovementPoint[] }) {
  const data = points.map((point) => ({ ...point, lost: -point.expiries }))

  return (
    <ChartContainer config={chartConfig} className="h-[150px] w-full">
      <BarChart data={data} stackOffset="sign" margin={{ left: 4, right: 8, top: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="period"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={monthLabel}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={32}
          allowDecimals={false}
          tickFormatter={(value: number) => String(Math.abs(value))}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(value) =>
                new Intl.DateTimeFormat('en-GB', {
                  month: 'long',
                  year: 'numeric',
                }).format(new Date(String(value)))
              }
              formatter={(value, name) => `${chartConfig[name as keyof typeof chartConfig]?.label ?? name}: ${Math.abs(Number(value))}`}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="new_members" stackId="movement" fill="var(--color-new_members)" radius={[0, 0, 0, 0]} />
        <Bar dataKey="renewals" stackId="movement" fill="var(--color-renewals)" radius={[3, 3, 0, 0]} />
        <Bar dataKey="lost" stackId="movement" fill="var(--color-lost)" radius={[0, 0, 3, 3]} />
      </BarChart>
    </ChartContainer>
  )
}
