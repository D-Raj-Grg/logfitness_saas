'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import {
  getMember,
  insertMember,
  updateMember as updateMemberRow,
  type MemberInsert,
} from '@/lib/db/members'
import {
  reactivateMember as reactivateMemberRpc,
  setMemberLeft,
} from '@/lib/db/memberships'
import type { CurrentStaff } from '@/lib/roles'
import {
  memberIdSchema,
  memberLeaveSchema,
  memberSchema,
  updateMemberSchema,
  type MemberInput,
} from '@/lib/validation/members'

export type MemberFormState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[]>
}

type DbError = { code?: string; message?: string }

function readMemberFields(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(key)
    return typeof value === 'string' ? value : undefined
  }
  const gender = text('gender')

  return {
    fullName: text('fullName'),
    phone: text('phone'),
    email: text('email'),
    homeBranchId: text('homeBranchId'),
    dateOfBirth: text('dateOfBirth'),
    gender: gender ? gender : null,
    address: text('address'),
    emergencyContactName: text('emergencyContactName'),
    emergencyContactPhone: text('emergencyContactPhone'),
    notes: text('notes'),
  }
}

/**
 * Owners can register into any branch. Everyone else is limited to the
 * branches on their own staff record. RLS rejects the write regardless; this
 * turns that rejection into a field error on the branch picker.
 */
function branchAllowed(staff: CurrentStaff, branchId: string) {
  return staff.role === 'owner' || staff.branchIds.includes(branchId)
}

// `status` is deliberately absent: the database derives it from memberships.
function toMemberColumns(input: MemberInput): Omit<MemberInsert, 'org_id'> {
  return {
    full_name: input.fullName,
    phone: input.phone,
    email: input.email,
    home_branch_id: input.homeBranchId,
    date_of_birth: input.dateOfBirth,
    gender: input.gender ?? null,
    address: input.address,
    emergency_contact_name: input.emergencyContactName,
    emergency_contact_phone: input.emergencyContactPhone,
    notes: input.notes,
  }
}

function mapDbError(error: unknown): MemberFormState {
  const { code, message } = (error ?? {}) as DbError
  if (code === '23505') {
    return { error: 'A member with that phone number already exists.' }
  }
  return { error: message ?? 'Something went wrong. Please try again.' }
}

export async function createMember(
  _prevState: MemberFormState,
  formData: FormData
): Promise<MemberFormState> {
  const staff = await requireRole('owner', 'manager', 'front_desk')

  const parsed = memberSchema.safeParse(readMemberFields(formData))

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  if (!branchAllowed(staff, parsed.data.homeBranchId)) {
    return {
      fieldErrors: {
        homeBranchId: ['You can only register members at your own branch.'],
      },
    }
  }

  let memberId: string
  try {
    // org_id and created_by come from the caller's own staff record, never
    // from the form. The RLS insert policy independently rejects any other org.
    const created = await insertMember({
      ...toMemberColumns(parsed.data),
      org_id: staff.orgId,
      created_by: staff.staffId,
    })
    memberId = created.id
  } catch (error) {
    return mapDbError(error)
  }

  revalidatePath('/members')
  redirect(`/members/${memberId}`)
}

export async function updateMember(
  _prevState: MemberFormState,
  formData: FormData
): Promise<MemberFormState> {
  const staff = await requireRole('owner', 'manager', 'front_desk')

  const parsed = updateMemberSchema.safeParse({
    ...readMemberFields(formData),
    memberId: formData.get('memberId'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  // Members are visible org-wide, so staff may edit a member from another
  // branch; only *moving* them is limited to the editor's own branches.
  const existing = await getMember(parsed.data.memberId)
  if (!existing) {
    return { error: 'That member could not be found.' }
  }
  if (
    existing.home_branch_id !== parsed.data.homeBranchId &&
    !branchAllowed(staff, parsed.data.homeBranchId)
  ) {
    return {
      fieldErrors: {
        homeBranchId: ['You can only move members to your own branch.'],
      },
    }
  }

  try {
    await updateMemberRow(parsed.data.memberId, toMemberColumns(parsed.data))
  } catch (error) {
    return mapDbError(error)
  }

  revalidatePath('/members')
  revalidatePath(`/members/${parsed.data.memberId}`)
  revalidatePath(`/members/${parsed.data.memberId}/edit`)

  return { success: 'Member details saved.' }
}

export async function markMemberLeft(
  _prevState: MemberFormState,
  formData: FormData
): Promise<MemberFormState> {
  await requireRole('owner', 'manager', 'front_desk')

  const parsed = memberLeaveSchema.safeParse({
    memberId: formData.get('memberId'),
    reason: formData.get('reason') ?? undefined,
  })

  if (!parsed.success) {
    return { error: 'That member could not be updated.' }
  }

  try {
    await setMemberLeft(parsed.data.memberId, parsed.data.reason)
  } catch (error) {
    return mapDbError(error)
  }

  revalidatePath('/members')
  revalidatePath(`/members/${parsed.data.memberId}`)

  return { success: 'Marked as left.' }
}

export async function reactivateMember(
  _prevState: MemberFormState,
  formData: FormData
): Promise<MemberFormState> {
  await requireRole('owner', 'manager', 'front_desk')

  const parsed = memberIdSchema.safeParse({ memberId: formData.get('memberId') })

  if (!parsed.success) {
    return { error: 'That member could not be updated.' }
  }

  try {
    await reactivateMemberRpc(parsed.data.memberId)
  } catch (error) {
    return mapDbError(error)
  }

  revalidatePath('/members')
  revalidatePath(`/members/${parsed.data.memberId}`)

  return { success: 'Member reactivated.' }
}
