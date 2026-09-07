'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireStaff } from '@/lib/auth'
import {
  deleteVisitor as deleteVisitorRow,
  getVisitor,
  insertVisitor,
  updateVisitor,
} from '@/lib/db/visitors'
import type { CurrentStaff } from '@/lib/roles'
import {
  visitorIdSchema,
  visitorSchema,
  visitorStatusSchema,
} from '@/lib/validation/visitors'

export type VisitorFormState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[]>
}

function readVisitorFields(formData: FormData) {
  const text = (key: string) => {
    const value = formData.get(key)
    return typeof value === 'string' ? value : undefined
  }

  return {
    fullName: text('fullName'),
    phone: text('phone'),
    branchId: text('branchId'),
    kind: text('kind') ?? 'enquiry',
    visitedOn: text('visitedOn'),
    note: text('note'),
    interestedPlanId: text('interestedPlanId'),
  }
}

/**
 * Owners log a visitor anywhere; everyone else logs one at a branch they
 * actually work at. RLS says the same thing -- this is here so the form can
 * explain the refusal instead of showing a zero-row write.
 */
function branchAllowed(staff: CurrentStaff, branchId: string) {
  return staff.role === 'owner' || staff.branchIds.includes(branchId)
}

function dbErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The visitor could not be saved.'
}

export async function createVisitor(
  _prevState: VisitorFormState,
  formData: FormData
): Promise<VisitorFormState> {
  // Every role, trainers included: a walk-in asks whoever is standing there.
  const staff = await requireStaff()

  const parsed = visitorSchema.safeParse(readVisitorFields(formData))

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  if (!branchAllowed(staff, parsed.data.branchId)) {
    return {
      fieldErrors: { branchId: ['You can only log a visitor at your own branch.'] },
    }
  }

  try {
    // org_id comes from the caller's staff record, never the form. `visited_on`
    // left absent falls to the trigger, which reads the org's own today.
    await insertVisitor({
      org_id: staff.orgId,
      branch_id: parsed.data.branchId,
      kind: parsed.data.kind,
      full_name: parsed.data.fullName,
      phone: parsed.data.phone,
      visited_on: parsed.data.visitedOn ?? undefined,
      note: parsed.data.note,
      interested_plan_id: parsed.data.interestedPlanId,
    })
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/visitors')
  return { success: `${parsed.data.fullName} was added to the visitor log.` }
}

export async function setVisitorStatus(
  _prevState: VisitorFormState,
  formData: FormData
): Promise<VisitorFormState> {
  await requireStaff()

  const parsed = visitorStatusSchema.safeParse({
    visitorId: formData.get('visitorId'),
    status: formData.get('status'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const visitor = await getVisitor(parsed.data.visitorId)
  if (!visitor) {
    return { error: 'That visitor could not be found.' }
  }

  // Converted is a fact about a member existing, not a status someone picks.
  // Only convert_visitor sets it, and nothing takes it back.
  if (visitor.status === 'converted') {
    return { error: 'That visitor is already registered as a member.' }
  }

  try {
    await updateVisitor(parsed.data.visitorId, { status: parsed.data.status })
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/visitors')
  return { success: 'Updated.' }
}

export async function deleteVisitor(
  _prevState: VisitorFormState,
  formData: FormData
): Promise<VisitorFormState> {
  // Owner-only in RLS too; the refusal is restated here so it reads as a rule
  // rather than as a write that quietly touched nothing.
  const staff = await requireStaff()

  if (staff.role !== 'owner') {
    return { error: 'Only an owner can delete a visitor record.' }
  }

  const parsed = visitorIdSchema.safeParse({ visitorId: formData.get('visitorId') })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  try {
    await deleteVisitorRow(parsed.data.visitorId)
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/visitors')
  return { success: 'The visitor record was deleted.' }
}
