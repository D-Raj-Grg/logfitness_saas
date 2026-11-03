'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addDays } from '@/lib/format'

const QUICK = [
  { label: 'Today', from: 0, to: 0 },
  { label: 'Yesterday', from: -1, to: -1 },
  { label: 'Last 7 days', from: -6, to: 0 },
]

/**
 * From / To dates for the attendance list, kept in the URL (?on=&to=) so a
 * day's list can be bookmarked or sent to a manager. Changing the dates drops
 * `page`, because page 3 of one day means nothing on another.
 */
export function DayRangePicker({
  on,
  to,
  today,
  params = {},
}: {
  on: string
  to: string
  today: string
  /**
   * URL parameter names, for a screen that already uses `on`/`to`/`page` for
   * something else (the member screen's Attendance tab). `fixed` is added to
   * every change, so the screen reopens on the same tab.
   */
  params?: { on?: string; to?: string; page?: string; fixed?: Record<string, string> }
}) {
  const onKey = params.on ?? 'on'
  const toKey = params.to ?? 'to'
  const pageKey = params.page ?? 'page'
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function navigate(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString())
    next.delete(pageKey)
    for (const [key, value] of Object.entries({ ...params.fixed, ...changes })) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    router.push(`${pathname}?${next.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-end gap-4 print:hidden">
      <div className="flex flex-col gap-2">
        <Label htmlFor="day-from">From</Label>
        <Input
          id="day-from"
          type="date"
          value={on}
          max={today}
          onChange={(event) => navigate({ [onKey]: event.target.value })}
          className="w-44"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="day-to">To</Label>
        <Input
          id="day-to"
          type="date"
          value={to}
          min={on}
          max={today}
          onChange={(event) => navigate({ [toKey]: event.target.value })}
          className="w-44"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {QUICK.map((range) => (
          <Button
            key={range.label}
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              navigate({
                [onKey]: addDays(today, range.from),
                [toKey]: range.to === range.from ? null : addDays(today, range.to),
              })
            }
          >
            {range.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
