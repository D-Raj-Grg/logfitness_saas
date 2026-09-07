'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ReportPeriod } from '@/lib/db/reports'
import { GROUP_LABELS, PERIOD_LABELS, type PeriodPreset, type ResolvedPeriod } from '@/lib/reports/period'

const PRESETS = Object.keys(PERIOD_LABELS) as PeriodPreset[]
const GROUPS = Object.keys(GROUP_LABELS) as ReportPeriod[]

/**
 * Writes `?period=`, `?from=`, `?to=`, `?group=` while preserving every other
 * search param -- `branch` above all, since the branch switcher lives in the
 * header and must survive a period change (and vice versa).
 */
export function PeriodPicker({ period }: { period: ResolvedPeriod }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function navigate(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key)
      else params.set(key, value)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  function onPresetChange(value: string | null) {
    if (!value) return
    const preset = value as PeriodPreset
    if (preset === 'custom') {
      navigate({ period: 'custom', from: period.from, to: period.to })
    } else {
      navigate({ period: preset, from: null, to: null })
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-4 print:hidden">
      <div className="flex flex-col gap-2">
        <Label htmlFor="period-preset">Period</Label>
        <Select value={period.preset} onValueChange={onPresetChange}>
          <SelectTrigger id="period-preset" className="h-9 w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((preset) => (
              <SelectItem key={preset} value={preset}>
                {PERIOD_LABELS[preset]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {period.preset === 'custom' ? (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="period-from">From</Label>
            <Input
              id="period-from"
              type="date"
              value={period.from}
              max={period.to}
              onChange={(event) => navigate({ from: event.target.value })}
              className="w-40"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="period-to">To</Label>
            <Input
              id="period-to"
              type="date"
              value={period.to}
              min={period.from}
              onChange={(event) => navigate({ to: event.target.value })}
              className="w-40"
            />
          </div>
        </>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="period-group">Group by</Label>
        <Select
          value={period.groupBy}
          onValueChange={(value) => {
            if (value) navigate({ group: value })
          }}
        >
          <SelectTrigger id="period-group" className="h-9 w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUPS.map((group) => (
              <SelectItem key={group} value={group}>
                {GROUP_LABELS[group]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
