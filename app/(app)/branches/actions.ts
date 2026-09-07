'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import { createBranch, setBranchStatus, updateBranch } from '@/lib/db/branches'
import { branchSchema } from '@/lib/validation/branches'

export type BranchFormState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[]>
}

function branchFormValues(formData: FormData) {
  return {
    name: formData.get('name'),
    address: formData.get('address') ?? undefined,
    phone: formData.get('phone') ?? undefined,
  }
}

export async function createBranchAction(
  _prevState: BranchFormState,
  formData: FormData
): Promise<BranchFormState> {
  const staff = await requireRole('owner')

  const parsed = branchSchema.safeParse(branchFormValues(formData))

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  try {
    // org_id comes from the caller's own staff record, not the form; the RLS
    // insert policy independently rejects any org but their own.
    await createBranch(staff.orgId, parsed.data)
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/branches')

  return { success: `${parsed.data.name} was added.` }
}

export async function updateBranchAction(
  _prevState: BranchFormState,
  formData: FormData
): Promise<BranchFormState> {
  await requireRole('owner')

  const branchId = formData.get('branchId')
  if (typeof branchId !== 'string' || !branchId) {
    return { error: 'That branch could not be found.' }
  }

  const parsed = branchSchema.safeParse(branchFormValues(formData))

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  try {
    await updateBranch(branchId, parsed.data)
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/branches')

  return { success: `${parsed.data.name} was updated.` }
}

const setBranchStatusSchema = z.object({
  branchId: z.uuid(),
  status: z.enum(['active', 'inactive']),
})

export async function setBranchStatusAction(
  _prevState: BranchFormState,
  formData: FormData
): Promise<BranchFormState> {
  await requireRole('owner')

  const parsed = setBranchStatusSchema.safeParse({
    branchId: formData.get('branchId'),
    status: formData.get('status'),
  })

  if (!parsed.success) {
    return { error: 'That branch could not be updated.' }
  }

  try {
    await setBranchStatus(parsed.data.branchId, parsed.data.status)
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/branches')

  return {
    success:
      parsed.data.status === 'inactive'
        ? 'The branch is deactivated. It keeps every member and every row of its history.'
        : 'The branch is active again.',
  }
}

function dbErrorMessage(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : null
  if (code === '23505') return 'A branch with that name already exists.'
  return error instanceof Error ? error.message : 'The branch could not be saved.'
}
