import type { Json } from '@/lib/types/database'

export type OrgHoliday = { id: string; on_date: string; name: string }

export const WEEKDAYS = [
  { iso: 1, label: 'Monday' },
  { iso: 2, label: 'Tuesday' },
  { iso: 3, label: 'Wednesday' },
  { iso: 4, label: 'Thursday' },
  { iso: 5, label: 'Friday' },
  { iso: 6, label: 'Saturday' },
  { iso: 7, label: 'Sunday' },
] as const

/** Reads orgs.settings.weekly_off defensively: anything odd means "no weekly off". */
export function readWeeklyOff(settings: Json): number[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return []
  const raw = settings.weekly_off
  if (!Array.isArray(raw)) return []
  const days = raw.filter(
    (day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 7
  )
  return [...new Set(days)].sort((a, b) => a - b)
}
