import { isRangeNotSatisfiable, lastPageFor } from '@/lib/db/paging'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

/**
 * One row of staff_attendance_detail. Postgres cannot prove view columns
 * non-null, so the ones the view structurally guarantees are narrowed here.
 */
type DetailRow = Database['public']['Views']['staff_attendance_detail']['Row']
export type StaffShiftRow = Omit<
  DetailRow,
  | 'id'
  | 'org_id'
  | 'staff_id'
  | 'branch_id'
  | 'branch_name'
  | 'clocked_in_at'
  | 'attended_on'
  | 'in_source'
  | 'auto_closed'
> & {
  id: string
  org_id: string
  staff_id: string
  branch_id: string
  branch_name: string
  clocked_in_at: string
  attended_on: string
  in_source: string
  auto_closed: boolean
}

export type StaffAttendanceResult = {
  rows: StaffShiftRow[]
  total: number
  page: number
  pageSize: number
}

/**
 * A staff member's own clock-in/out shifts, newest first. RLS decides what the
 * caller may see (owners all, managers their branches); `branchIds` narrows it
 * the same way every other screen does.
 */
export async function listStaffAttendance(
  staffId: string,
  args: {
    on?: string
    to?: string
    branchIds?: string[] | null
    page: number
    pageSize: number
  }
): Promise<StaffAttendanceResult> {
  const supabase = await createClient()

  // A function so a page past the end can be re-asked for the last real page.
  const build = (page: number) => {
    let request = supabase
      .from('staff_attendance_detail')
      .select('*', { count: 'exact' })
      .eq('staff_id', staffId)

    if (args.branchIds) request = request.in('branch_id', args.branchIds)
    if (args.on) request = request.gte('attended_on', args.on)
    if (args.to) request = request.lte('attended_on', args.to)

    const from = (page - 1) * args.pageSize
    return request
      .order('clocked_in_at', { ascending: false })
      // Two shifts can start at the same instant; a paged list needs a unique
      // last sort key or the boundary between pages is undefined.
      .order('id', { ascending: false })
      .range(from, from + args.pageSize - 1)
  }

  let page = args.page
  let result = await build(page)
  if (isRangeNotSatisfiable(result.error)) {
    const probe = await build(1)
    if (probe.error) throw probe.error
    page = lastPageFor(probe.count ?? 0, args.pageSize)
    result = await build(page)
  }

  const { data, error, count } = result
  if (error) throw error
  return {
    rows: (data ?? []) as StaffShiftRow[],
    total: count ?? 0,
    page,
    pageSize: args.pageSize,
  }
}

export type StaffAttendanceSummary =
  Database['public']['Functions']['staff_attendance_summary']['Returns'][number]

/** Last clock-in, whether they are on shift, and days / minutes worked in a window. */
export async function getStaffAttendanceSummary(
  staffId: string,
  window: { from?: string; to?: string } = {}
): Promise<StaffAttendanceSummary | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('staff_attendance_summary', {
    p_staff_id: staffId,
    p_from: window.from ?? undefined,
    p_to: window.to ?? undefined,
  })
  if (error) throw error
  return data?.[0] ?? null
}
