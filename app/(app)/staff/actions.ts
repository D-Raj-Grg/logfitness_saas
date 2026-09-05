'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireStaff } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { inviteStaffSchema, setStaffStatusSchema } from '@/lib/validation/staff'

export type StaffFormState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[]>
}

export async function inviteStaff(
  _prevState: StaffFormState,
  formData: FormData
): Promise<StaffFormState> {
  const staff = await requireStaff()

  const parsed = inviteStaffSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    phone: formData.get('phone') ?? undefined,
    role: formData.get('role'),
    branchIds: formData.getAll('branchIds').map(String),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const supabase = await createClient()

  // org_id is set from the caller's own staff record rather than the form, and
  // the RLS insert policy independently rejects any org but their own.
  const { error } = await supabase.from('staff').insert({
    org_id: staff.orgId,
    full_name: parsed.data.fullName,
    email: parsed.data.email,
    phone: parsed.data.phone,
    role: parsed.data.role,
    branch_ids: parsed.data.branchIds,
    status: 'invited',
    invited_by: staff.staffId,
  })

  if (error) {
    if (error.code === '23505') {
      return { error: 'Someone with that email address is already on your team.' }
    }
    return { error: error.message }
  }

  revalidatePath('/staff')

  return {
    success: `${parsed.data.fullName} was invited. They can sign up with ${parsed.data.email} to get in.`,
  }
}

export async function setStaffStatus(
  _prevState: StaffFormState,
  formData: FormData
): Promise<StaffFormState> {
  await requireStaff()

  const parsed = setStaffStatusSchema.safeParse({
    staffId: formData.get('staffId'),
    status: formData.get('status'),
  })

  if (!parsed.success) {
    return { error: 'That staff member could not be updated.' }
  }

  const supabase = await createClient()

  const { error } = await supabase
    .from('staff')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.staffId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/staff')
  return { success: 'Updated.' }
}
