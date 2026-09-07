'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import {
  archiveMember as archiveMemberRpc,
  deleteMember as deleteMemberRow,
  getMember,
  inviteMemberToApp as inviteMemberToAppRpc,
  registerMember,
  restoreMember as restoreMemberRpc,
  updateMember as updateMemberRow,
  type MemberInsert,
  type RegisterMemberResult,
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
import { convertVisitor } from '@/lib/db/visitors'
import type { CurrentStaff } from '@/lib/roles'
import {
  inviteMemberToAppSchema,
  memberArchiveSchema,
  memberDeleteSchema,
  memberIdSchema,
  memberLeaveSchema,
  memberSaleSchema,
  memberSchema,
  updateMemberSchema,
  type MemberInput,
} from '@/lib/validation/members'

export type MemberFormState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[]>
}

type DbError = { code?: string; message?: string; hint?: string }

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

/** The optional sale half of the registration form. */
function readSaleFields(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(key)
    return typeof value === 'string' ? value : undefined
  }

  return {
    sell: text('sellPlan') === 'true' ? 'true' : 'false',
    planId: text('salePlanId'),
    discountPaisa: text('saleDiscountPaisa'),
    amountPaidPaisa: text('saleAmountPaidPaisa'),
    method: text('saleMethod') ?? undefined,
    referenceNo: text('saleReferenceNo'),
    startDate: text('saleStartDate'),
  }
}

/**
 * register_member() tags every refusal with a hint naming the half that raised
 * it, so a plan that is not sold here does not read as a problem with the
 * member's phone number. Within the sale half the sentence picks the field --
 * those messages live in the RPC and are the only copy of the rule.
 */
function mapRegisterError(error: unknown): MemberFormState {
  const { code, message, hint } = (error ?? {}) as DbError
  const text = (message ?? 'Something went wrong. Please try again.').replace(
    /^[A-Z0-9]{5}:\s*/,
    ''
  )

  if (hint === 'member') {
    if (code === '23505') {
      return {
        fieldErrors: { phone: ['A member with that phone number already exists.'] },
      }
    }
    if (code === '42501') return { fieldErrors: { homeBranchId: [text] } }
    return { error: text }
  }

  if (hint === 'sale') {
    if (/start date/i.test(text)) return { fieldErrors: { startDate: [text] } }
    if (/discount/i.test(text)) return { fieldErrors: { discountPaisa: [text] } }
    if (/payment/i.test(text)) return { fieldErrors: { amountPaidPaisa: [text] } }
    if (/plan/i.test(text)) return { fieldErrors: { planId: [text] } }
    return { error: text }
  }

  return mapDbError(error)
}

export async function createMember(
  _prevState: MemberFormState,
  formData: FormData
): Promise<MemberFormState> {
  const staff = await requireRole('owner', 'manager', 'front_desk')

  const parsed = memberSchema.safeParse(readMemberFields(formData))
  const sale = memberSaleSchema.safeParse(readSaleFields(formData))

  // Both halves report at once. Fixing one field per round trip is exactly the
  // back-and-forth this form exists to remove.
  if (!parsed.success || !sale.success) {
    return {
      fieldErrors: {
        ...(parsed.success ? {} : z.flattenError(parsed.error).fieldErrors),
        ...(sale.success ? {} : z.flattenError(sale.error).fieldErrors),
      },
    }
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

  const selling = sale.data.sell

  let result: RegisterMemberResult
  try {
    // One transaction: org_id and created_by are read from the caller's own
    // claims inside the RPC, and a sale that is refused registers nobody -- so
    // the desk can correct one field and submit the same form again.
    result = await registerMember({
      fullName: parsed.data.fullName,
      phone: parsed.data.phone,
      homeBranchId: parsed.data.homeBranchId,
      email: parsed.data.email,
      dateOfBirth: parsed.data.dateOfBirth,
      gender: parsed.data.gender ?? null,
      address: parsed.data.address,
      emergencyContactName: parsed.data.emergencyContactName,
      emergencyContactPhone: parsed.data.emergencyContactPhone,
      notes: parsed.data.notes,
      planId: selling ? sale.data.planId : null,
      discountPaisa: selling ? sale.data.discountPaisa : 0,
      amountPaidPaisa: selling ? sale.data.amountPaidPaisa : 0,
      method: selling ? sale.data.method : 'cash',
      referenceNo: selling ? sale.data.referenceNo : null,
      startDate: selling ? sale.data.startDate : null,
    })
  } catch (error) {
    return mapRegisterError(error)
  }

  // The member exists either way: a photo that fails to upload is reported on
  // the profile, not by throwing away a completed registration.
  if (photo) {
    try {
      const path = memberPhotoPath(staff.orgId, result.member_id, photo.file.type)
      await uploadMemberPhoto(path, photo.file)
      await updateMemberRow(result.member_id, { photo_path: path })
    } catch {
      // Swallowed on purpose -- see above. The edit screen can retry.
    }
  }

  // Registration may have started from the visitor log. The link is written
  // after the fact, and a failure to write it does not undo a member who now
  // exists: the desk can set the status by hand, and refusing the registration
  // because the bookkeeping failed would be the worse trade.
  const visitorId = formData.get('visitorId')
  if (typeof visitorId === 'string' && visitorId) {
    try {
      await convertVisitor(visitorId, result.member_id)
    } catch {
      // Swallowed on purpose -- see above.
    }
    revalidatePath('/visitors')
  }

  revalidatePath('/members')
  if (result.sold) {
    revalidatePath('/payments')
    revalidatePath('/')
  }

  // The invoice id, not a sentence: the profile renders the receipt from the
  // row itself, so a hand-edited URL cannot put words on the page.
  redirect(
    result.invoice_id
      ? `/members/${result.member_id}?invoice=${result.invoice_id}`
      : `/members/${result.member_id}`
  )
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


/**
 * Archive, restore, and -- for the owner alone -- delete.
 *
 * The three are deliberately separate actions rather than one with a mode: the
 * confirmation each needs is different, and so is who may run it.
 */
export async function archiveMember(
  _prevState: MemberFormState,
  formData: FormData
): Promise<MemberFormState> {
  await requireRole('owner', 'manager', 'front_desk')

  const parsed = memberArchiveSchema.safeParse({
    memberId: formData.get('memberId'),
    reason: formData.get('reason') ?? undefined,
  })

  if (!parsed.success) {
    return { error: 'That member could not be archived.' }
  }

  try {
    await archiveMemberRpc(parsed.data.memberId, parsed.data.reason)
  } catch (error) {
    return mapDbError(error)
  }

  revalidatePath('/members')
  revalidatePath(`/members/${parsed.data.memberId}`)

  return { success: 'Member archived.' }
}

export async function restoreMember(
  _prevState: MemberFormState,
  formData: FormData
): Promise<MemberFormState> {
  await requireRole('owner', 'manager', 'front_desk')

  const parsed = memberIdSchema.safeParse({ memberId: formData.get('memberId') })

  if (!parsed.success) {
    return { error: 'That member could not be restored.' }
  }

  try {
    await restoreMemberRpc(parsed.data.memberId)
  } catch (error) {
    return mapDbError(error)
  }

  revalidatePath('/members')
  revalidatePath(`/members/${parsed.data.memberId}`)

  return { success: 'Member restored.' }
}

/**
 * The irreversible one. requireRole keeps a non-owner out of the action, the
 * delete policy keeps them out of the row, and the typed name keeps the owner
 * from deleting the profile they merely had open. All three, because this
 * takes the member's payment history with it.
 */
export async function deleteMember(
  _prevState: MemberFormState,
  formData: FormData
): Promise<MemberFormState> {
  await requireRole('owner')

  const parsed = memberDeleteSchema.safeParse({
    memberId: formData.get('memberId'),
    confirmName: formData.get('confirmName'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const member = await getMember(parsed.data.memberId)
  if (!member) {
    return { error: 'That member could not be found.' }
  }

  if (
    member.full_name.trim().toLowerCase() !== parsed.data.confirmName.toLowerCase()
  ) {
    return {
      fieldErrors: { confirmName: ['That does not match the member\'s name.'] },
    }
  }

  let deleted: boolean
  try {
    deleted = await deleteMemberRow(parsed.data.memberId)
  } catch (error) {
    return mapDbError(error)
  }

  // RLS refuses the row rather than raising, so nothing deleted means the
  // caller is not the owner of this org -- not that the member had gone.
  if (!deleted) {
    return { error: 'Only the gym owner can delete a member.' }
  }

  // The photo outlives the row it belonged to: storage has no foreign key.
  if (member.photo_path) {
    await removeMemberPhoto(member.photo_path).catch(() => {})
  }

  revalidatePath('/members')
  revalidatePath('/')

  redirect('/members')
}
