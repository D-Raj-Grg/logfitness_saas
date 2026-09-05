import type { CheckInBanner } from '@/lib/attendance'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import type { AttendanceLogQuery } from '@/lib/validation/attendance'

export type AttendanceRow = Database['public']['Tables']['attendance']['Row']
export type AttendanceMethod = Database['public']['Enums']['attendance_method']

/**
 * One row of attendance_detail. Postgres cannot prove view columns non-null, so
 * the columns the view structurally guarantees are narrowed here.
 */
export type AttendanceDetailRow = Omit<
  Database['public']['Views']['attendance_detail']['Row'],
  | 'id'
  | 'org_id'
  | 'branch_id'
  | 'branch_name'
  | 'member_id'
  | 'member_code'
  | 'full_name'
  | 'phone'
  | 'method'
  | 'checked_in_at'
  | 'attended_on'
  | 'due_paisa_at_checkin'
  | 'is_override'
> & {
  id: string
  org_id: string
  branch_id: string
  branch_name: string
  member_id: string
  member_code: string
  full_name: string
  phone: string
  method: AttendanceMethod
  checked_in_at: string
  attended_on: string
  due_paisa_at_checkin: number
  is_override: boolean
}

/** What check_in_member() hands back. Mirrors the jsonb the RPC builds. */
export type CheckInResult = {
  ok: boolean
  reason: 'already_checked_in' | null
  banner: CheckInBanner
  due_paisa: number
  member: {
    id: string
    member_code: string
    full_name: string
    phone: string
    photo_path: string | null
    status: Database['public']['Enums']['member_status']
    home_branch_id: string
  }
  branch: { id: string; name: string }
  membership: {
    id: string
    plan_name: string
    plan_type: Database['public']['Enums']['plan_type']
    status: Database['public']['Enums']['membership_status']
    end_date: string | null
    days_to_expiry: number | null
    sessions_remaining: number | null
  } | null
  attendance?: {
    id: string
    checked_in_at: string
    attended_on: string
    method: AttendanceMethod
    is_override: boolean
  }
  existing?: {
    id: string
    checked_in_at: string
    checked_out_at: string | null
    branch_id: string
  }
}

function unwrap<T>(result: {
  data: unknown
  error: { message: string; code?: string } | null
}) {
  if (result.error) throw result.error
  return result.data as T
}

export async function checkInMember(args: {
  memberId: string
  branchId: string
  method?: AttendanceMethod
  override?: boolean
  overrideReason?: string | null
  notes?: string | null
}) {
  const supabase = await createClient()

  return unwrap<CheckInResult>(
    await supabase.rpc('check_in_member', {
      p_member_id: args.memberId,
      p_branch_id: args.branchId,
      p_method: args.method ?? 'manual',
      p_override: args.override ?? false,
      p_override_reason: args.overrideReason ?? undefined,
      p_notes: args.notes ?? undefined,
    })
  )
}

export async function checkOutMember(attendanceId: string) {
  const supabase = await createClient()

  return unwrap<{
    ok: boolean
    reason: 'already_checked_out' | null
    attendance_id: string
    checked_in_at?: string
    checked_out_at: string
  }>(await supabase.rpc('check_out_member', { p_attendance_id: attendanceId }))
}

/** Who is in the building right now, newest arrival first. */
export async function inGymNow(branchId?: string) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('in_gym_now', {
    p_branch_id: branchId ?? undefined,
  })

  if (error) throw error
  return data ?? []
}

export async function attendanceDaySummary(args: { on?: string; branchId?: string } = {}) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('attendance_day_summary', {
    p_on: args.on ?? undefined,
    p_branch_id: args.branchId ?? undefined,
  })

  if (error) throw error
  return data ?? []
}

export async function absentMembers(args: { branchId?: string; minDays?: number } = {}) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('absent_members', {
    p_branch_id: args.branchId ?? undefined,
    p_min_days: args.minDays ?? 14,
  })

  if (error) throw error
  return data ?? []
}

export type QrToken = {
  token: string
  member_id: string
  ttl_seconds: number
  expires_at: string
}

export type QrVerification =
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'not_visible' }
  | {
      valid: true
      reason: null
      member_id: string
      org_id: string
      member_code: string
      full_name: string
      home_branch_id: string
      expires_at: string
    }

/**
 * A short-lived QR token for one member. Signed in Postgres with a key held in
 * Vault, so the Flutter app (Phase 6) mints its own by calling the same RPC.
 */
export async function mintQrToken(args: { memberId?: string; ttlSeconds?: number } = {}) {
  const supabase = await createClient()

  return unwrap<QrToken>(
    await supabase.rpc('mint_qr_token', {
      p_member_id: args.memberId ?? undefined,
      p_ttl_seconds: args.ttlSeconds ?? 90,
    })
  )
}

/**
 * Checks a scanned token. Deliberately does not record the visit: the scanner
 * calls checkInMember() with method 'qr' afterwards, so the door rules live in
 * exactly one place.
 */
export async function verifyQrToken(token: string) {
  const supabase = await createClient()

  return unwrap<QrVerification>(
    await supabase.rpc('verify_qr_token', { p_token: token })
  )
}

/** The attendance tab on a member profile. */
export async function listAttendanceForMember(memberId: string, limit = 60) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('attendance_detail')
    .select('*')
    .eq('member_id', memberId)
    .order('checked_in_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as AttendanceDetailRow[]
}

export type AttendanceLogResult = {
  rows: AttendanceDetailRow[]
  total: number
  page: number
  pageSize: number
}

/** The branch day log behind the check-in screen. */
export async function listAttendance(
  query: AttendanceLogQuery
): Promise<AttendanceLogResult> {
  const supabase = await createClient()

  let request = supabase
    .from('attendance_detail')
    .select('*', { count: 'exact' })

  if (query.branchId) request = request.eq('branch_id', query.branchId)
  if (query.on) request = request.eq('attended_on', query.on)

  const from = (query.page - 1) * query.pageSize
  const to = from + query.pageSize - 1

  const { data, error, count } = await request
    .order('checked_in_at', { ascending: false })
    .range(from, to)

  if (error) throw error

  return {
    rows: (data ?? []) as AttendanceDetailRow[],
    total: count ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  }
}
