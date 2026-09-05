'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import {
  checkInMember as checkInMemberRow,
  checkOutMember as checkOutMemberRow,
  type CheckInResult,
} from '@/lib/db/attendance'
import { searchMembersForCheckIn } from '@/lib/db/members'
import { checkInSchema, checkOutSchema } from '@/lib/validation/attendance'

export type CheckInActionState = {
  error?: string
  fieldErrors?: Record<string, string[]>
  result?: CheckInResult
}

export type CheckOutActionState = {
  error?: string
  success?: string
}

const DESK_ROLES = ['owner', 'manager', 'front_desk'] as const

/**
 * The RPCs raise with a sentence meant for the person at the desk. PostgREST
 * sometimes prefixes it with the SQLSTATE ("P0001: ..."), which is noise here.
 */
function rpcErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : null
  if (!message) return fallback
  return message.replace(/^[A-Z0-9]{5}:\s*/, '')
}

function revalidateDesk(memberId?: string) {
  revalidatePath('/check-in')
  revalidatePath('/reports/absent')
  if (memberId) {
    revalidatePath(`/members/${memberId}`)
    revalidatePath('/members/[id]', 'page')
  }
}

function optional(formData: FormData, key: string) {
  const value = formData.get(key)
  return value === null ? undefined : String(value)
}

/**
 * Type-ahead for the check-in box. A read, but exposed as an action so the
 * console needs no route of its own — and so the search runs under the caller's
 * RLS rather than in the browser.
 */
export async function searchMembers(term: string) {
  await requireRole(...DESK_ROLES)

  const parsed = z.string().trim().max(120).safeParse(term)
  if (!parsed.success || parsed.data.length < 2) return { members: [] }

  const rows = await searchMembersForCheckIn(parsed.data)

  return {
    members: rows.map((row) => ({
      id: row.id,
      member_code: row.member_code,
      full_name: row.full_name,
      phone: row.phone,
      status: row.status,
      home_branch_id: row.home_branch_id,
      home_branch_name: row.home_branch_name,
      days_to_expiry: row.days_to_expiry,
      due_paisa: row.due_paisa,
      membership_status: row.membership_status,
      current_plan_name: row.current_plan_name,
    })),
  }
}

export async function checkIn(
  _prevState: CheckInActionState,
  formData: FormData
): Promise<CheckInActionState> {
  const staff = await requireRole(...DESK_ROLES)

  const parsed = checkInSchema.safeParse({
    memberId: formData.get('memberId'),
    branchId: formData.get('branchId'),
    method: formData.get('method') ?? undefined,
    override: optional(formData, 'override'),
    overrideReason: optional(formData, 'overrideReason'),
    notes: optional(formData, 'notes'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  // RLS would refuse this anyway, but an opaque policy error at the desk is
  // worse than a sentence naming the actual problem.
  if (staff.role !== 'owner' && !staff.branchIds.includes(parsed.data.branchId)) {
    return { fieldErrors: { branchId: ['You do not work at that branch'] } }
  }

  let result: CheckInResult
  try {
    result = await checkInMemberRow({
      memberId: parsed.data.memberId,
      branchId: parsed.data.branchId,
      method: parsed.data.method,
      override: parsed.data.override,
      overrideReason: parsed.data.overrideReason,
      notes: parsed.data.notes,
    })
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The check-in could not be recorded.') }
  }

  if (result.ok) revalidateDesk(parsed.data.memberId)

  return { result }
}

export async function checkOut(
  _prevState: CheckOutActionState,
  formData: FormData
): Promise<CheckOutActionState> {
  await requireRole(...DESK_ROLES)

  const parsed = checkOutSchema.safeParse({
    attendanceId: formData.get('attendanceId'),
  })

  if (!parsed.success) {
    return { error: 'That check-in could not be found.' }
  }

  try {
    const result = await checkOutMemberRow(parsed.data.attendanceId)
    if (!result.ok) {
      return { error: 'They were already checked out.' }
    }
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The check-out could not be recorded.') }
  }

  revalidateDesk()
  return { success: 'Checked out.' }
}
