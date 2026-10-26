'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import { getFee, insertFee, listFees, updateFee as updateFeeRow } from '@/lib/db/fees'
import { feeIdSchema, feeSchema, updateFeeSchema } from '@/lib/validation/fees'

export type FeeFormState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[]>
}

function feeFormValues(formData: FormData) {
  return {
    name: formData.get('name'),
    chargeRule: formData.get('chargeRule'),
    amountPaisa: formData.get('amountPaisa'),
    allPlans: formData.get('allPlans') === 'true',
    planIds: formData.getAll('planIds').map(String),
    isActive: formData.get('isActive') !== 'false',
  }
}

function dbErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : null
  if (code === '23505') return 'A fee with that name already exists.'
  const { message } = (error ?? {}) as { message?: string }
  return message ?? 'The fee could not be saved.'
}

function revalidateFees() {
  // /settings/fees and /plans read the catalogue from the page cache. The sale
  // forms get their fees from the loadPlansForBranch Server Action, which
  // revalidation cannot reach -- and revalidating /members while the
  // registration form is open would remount it and wipe what the desk had
  // half-typed (see plans/actions.ts).
  revalidatePath('/settings/fees')
  revalidatePath('/plans')
}

/**
 * Pricing the gym is the owner's job: RLS only lets an owner write `fees`, and
 * says so by updating zero rows, so the role is checked here to give a plain
 * refusal instead.
 */
export async function createFee(
  _prevState: FeeFormState,
  formData: FormData
): Promise<FeeFormState> {
  const staff = await requireRole('owner')

  const parsed = feeSchema.safeParse(feeFormValues(formData))
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  try {
    // New fees go to the end of the list; the owner has no ordering control
    // yet, and a stable append order is what the printed invoice reads.
    const existing = await listFees()
    const nextSort = existing.reduce((max, fee) => Math.max(max, fee.sort_order), -1) + 1

    await insertFee({
      // org_id comes from the caller's staff record, never the form; the RLS
      // insert policy independently rejects any other org.
      org_id: staff.orgId,
      name: parsed.data.name,
      charge_rule: parsed.data.chargeRule,
      amount_paisa: parsed.data.amountPaisa,
      all_plans: parsed.data.allPlans,
      plan_ids: parsed.data.allPlans ? [] : parsed.data.planIds,
      is_active: true,
      sort_order: nextSort,
    })
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidateFees()
  return { success: `${parsed.data.name} was added.` }
}

export async function updateFee(
  _prevState: FeeFormState,
  formData: FormData
): Promise<FeeFormState> {
  await requireRole('owner')

  const parsed = updateFeeSchema.safeParse({
    feeId: formData.get('feeId'),
    ...feeFormValues(formData),
  })
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const existing = await getFee(parsed.data.feeId)
  if (!existing) return { error: 'That fee could not be found.' }

  try {
    await updateFeeRow(parsed.data.feeId, {
      name: parsed.data.name,
      charge_rule: parsed.data.chargeRule,
      amount_paisa: parsed.data.amountPaisa,
      all_plans: parsed.data.allPlans,
      plan_ids: parsed.data.allPlans ? [] : parsed.data.planIds,
      is_active: parsed.data.isActive,
    })
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidateFees()
  return { success: 'Fee saved. It applies to new sales only.' }
}

export async function setFeeActive(
  _prevState: FeeFormState,
  formData: FormData
): Promise<FeeFormState> {
  await requireRole('owner')

  const parsed = feeIdSchema
    .extend({ isActive: z.enum(['true', 'false']) })
    .safeParse({
      feeId: formData.get('feeId'),
      isActive: formData.get('isActive'),
    })
  if (!parsed.success) return { error: 'That fee could not be updated.' }

  try {
    await updateFeeRow(parsed.data.feeId, { is_active: parsed.data.isActive === 'true' })
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidateFees()
  return { success: 'Updated.' }
}
