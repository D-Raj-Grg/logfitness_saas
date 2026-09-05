'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import {
  getMember,
  insertMember,
  inviteMemberToApp as inviteMemberToAppRpc,
  updateMember as updateMemberRow,
  type MemberInsert,
} from '@/lib/db/members'
import {
  reactivateMember as reactivateMemberRpc,
  setMemberLeft,
} from '@/lib/db/memberships'
import {
  ALLOWED_PHOTO_TYPES,
  MAX_PHOTO_BYTES,
  memberPhotoPath,
  removeMemberPhoto,
  uploadMemberPhoto,
} from '@/lib/db/photos'
import type { CurrentStaff } from '@/lib/roles'
import {
  inviteMemberToAppSchema,
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

/**
 * Photos are optional, so an empty file input is not an error. Anything that is
 * present has to pass the same limits the bucket enforces, checked here so the
 * failure is a field message rather than a storage exception.
 */
type PhotoPick = { ok: true; file: File } | { ok: false; error: string }

function readPhoto(formData: FormData): PhotoPick | null {
  const file = formData.get('photo')
  if (!(file instanceof File) || file.size === 0) return null

  if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
    return { ok: false, error: 'Photos must be a JPEG, PNG, or WebP image.' }
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, error: 'Photos must be 5 MB or smaller.' }
  }

  return { ok: true, file }
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

  const photo = readPhoto(formData)
  if (photo && !photo.ok) {
    return { fieldErrors: { photo: [photo.error] } }
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

  // The member exists either way: a photo that fails to upload is reported on
  // the profile, not by throwing away a completed registration.
  if (photo) {
    try {
      const path = memberPhotoPath(staff.orgId, memberId, photo.file.type)
      await uploadMemberPhoto(path, photo.file)
      await updateMemberRow(memberId, { photo_path: path })
    } catch {
      // Swallowed on purpose -- see above. The edit screen can retry.
    }
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

  const photo = readPhoto(formData)
  if (photo && !photo.ok) {
    return { fieldErrors: { photo: [photo.error] } }
  }

  const removePhoto = formData.get('removePhoto') === 'true'

  try {
    let photoPath = existing.photo_path

    if (photo) {
      photoPath = memberPhotoPath(staff.orgId, parsed.data.memberId, photo.file.type)
      await uploadMemberPhoto(photoPath, photo.file)
    } else if (removePhoto) {
      photoPath = null
    }

    await updateMemberRow(parsed.data.memberId, {
      ...toMemberColumns(parsed.data),
      photo_path: photoPath,
    })

    // Only after the row points somewhere else is the old object safe to drop.
    if (existing.photo_path && existing.photo_path !== photoPath) {
      await removeMemberPhoto(existing.photo_path).catch(() => {})
    }
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

/**
 * invite_member() raises three distinct conditions, all of which arrive here
 * as a Postgres error rather than a thrown TypeScript one. unique_violation
 * covers two different situations under the same SQLSTATE (23505): the RPC's
 * own guard against re-inviting a linked member, and the members_org_email_key
 * index rejecting an email another member in the org already has. The two are
 * told apart by the message the RPC (or Postgres itself) attached.
 */
function mapInviteError(error: DbError): MemberFormState {
  const { code, message } = error

  if (code === 'P0002') {
    return { error: 'That member could not be found.' }
  }

  if (code === '23505') {
    if (message?.includes('already has an app account')) {
      return { error: 'This member already has an app account.' }
    }
    return {
      fieldErrors: {
        email: ['Another member in this gym already uses that email address.'],
      },
    }
  }

  return { error: message ?? 'Something went wrong. Please try again.' }
}

export async function inviteMemberToApp(
  _prevState: MemberFormState,
  formData: FormData
): Promise<MemberFormState> {
  await requireRole('owner', 'manager', 'front_desk')

  const parsed = inviteMemberToAppSchema.safeParse({
    memberId: formData.get('memberId'),
    email: formData.get('email'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  try {
    await inviteMemberToAppRpc(parsed.data.memberId, parsed.data.email)
  } catch (error) {
    return mapInviteError(error as DbError)
  }

  revalidatePath(`/members/${parsed.data.memberId}`)

  return {
    success: `Invited. They can sign up with ${parsed.data.email} in the app.`,
  }
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
