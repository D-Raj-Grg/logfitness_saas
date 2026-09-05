'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import { assignableRoles } from '@/lib/roles'
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
  const staff = await requireRole('owner', 'manager')

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

  // RLS stops a manager from creating an owner, but it does permit a manager to
  // create another manager. That is wider than the product intends, so the
  // ceiling is applied here, from the same table the form renders its options
  // from. RLS remains the backstop; this states the rule.
  if (!assignableRoles(staff.role).includes(parsed.data.role)) {
    return {
      fieldErrors: {
        role: ['You cannot give someone that role.'],
      },
    }
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
  const actor = await requireRole('owner', 'manager')

  const parsed = setStaffStatusSchema.safeParse({
    staffId: formData.get('staffId'),
    status: formData.get('status'),
  })

  if (!parsed.success) {
    return { error: 'That staff member could not be updated.' }
  }

  if (parsed.data.staffId === actor.staffId) {
    return { error: 'You cannot change your own status.' }
  }

  const supabase = await createClient()

  // Read the target first so the refusal is a message rather than an opaque
  // RLS rejection, and so a manager cannot deactivate an owner.
  const { data: target } = await supabase
    .from('staff')
    .select('id, role')
    .eq('id', parsed.data.staffId)
    .maybeSingle()

  if (!target) {
    return { error: 'That staff member could not be found.' }
  }

  if (target.role === 'owner' && actor.role !== 'owner') {
    return { error: 'Only an owner can change another owner.' }
  }

  const { error } = await supabase
    .from('staff')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.staffId)
    // Redundant next to RLS and the read above, but it keeps the blast radius
    // of any future policy change to a single org.
    .eq('org_id', actor.orgId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/staff')
  return { success: 'Updated.' }
}
