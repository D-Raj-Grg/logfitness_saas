import { setOrgSetting } from '@/lib/db/orgs'
import { createClient } from '@/lib/supabase/server'
import type { OrgHoliday } from '@/lib/schedule'

/**
 * The gym's closed days: weekly-off weekdays (orgs.settings.weekly_off, ISO
 * 1=Mon..7=Sun) and one-off holidays (org_holidays). Both are org-level, and
 * the members' attendance calendar reads them to show "off" instead of
 * "absent".
 *
 * org_holidays and its two RPCs arrived in 20261109130000_gym_schedule_and_calendar
 * and are not in the generated types of this branch yet, hence the narrow local
 * shape below instead of the typed client. Drop it once types are regenerated.
 */
type HolidayQuery = {
  select: (columns: string) => {
    order: (
      column: string,
      options: { ascending: boolean }
    ) => PromiseLike<{
      data: OrgHoliday[] | null
      error: { message: string; code?: string } | null
    }>
  }
}
type HolidayClient = {
  from: (table: 'org_holidays') => HolidayQuery
  rpc: (
    fn: 'add_org_holiday' | 'remove_org_holiday',
    args: Record<string, string>
  ) => PromiseLike<{ error: { message: string; code?: string } | null }>
}

async function holidayClient() {
  return (await createClient()) as unknown as HolidayClient
}

/** Every holiday, soonest first. Staff can read; RLS keeps it to the org. */
export async function listOrgHolidays(): Promise<OrgHoliday[]> {
  const supabase = await holidayClient()
  const { data, error } = await supabase
    .from('org_holidays')
    .select('id, on_date, name')
    .order('on_date', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function addOrgHoliday(onDate: string, name: string) {
  const supabase = await holidayClient()
  const { error } = await supabase.rpc('add_org_holiday', {
    p_on_date: onDate,
    p_name: name,
  })
  if (error) throw error
}

export async function removeOrgHoliday(id: string) {
  const supabase = await holidayClient()
  const { error } = await supabase.rpc('remove_org_holiday', { p_id: id })
  if (error) throw error
}

/** set_org_setting allows owner and manager for this one key. */
export async function setWeeklyOff(days: number[]) {
  await setOrgSetting('weekly_off', days)
}
