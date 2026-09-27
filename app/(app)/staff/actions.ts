'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import {
  enqueueNotification,
  previewNotificationTemplate,
} from '@/lib/db/notifications'
import { assignableRoles } from '@/lib/roles'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  inviteStaffSchema,
  resetStaffPasswordSchema,
  setStaffStatusSchema,
  updateStaffAssignmentSchema,
} from '@/lib/validation/staff'

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
  const { data: invited, error } = await supabase
    .from('staff')
    .insert({
      org_id: staff.orgId,
      full_name: parsed.data.fullName,
      email: parsed.data.email,
      phone: parsed.data.phone,
      role: parsed.data.role,
      branch_ids: parsed.data.branchIds,
      status: 'invited',
      invited_by: staff.staffId,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { error: 'Someone with that email address is already on your team.' }
    }
    return { error: error.message }
  }

  // Until Phase 5 an invited person was simply told, by whoever invited them,
  // to go and sign up. Now the invitation is queued as an email -- and if the
  // gym has no email gateway the message lands in the log as `skipped`, so the
  // flow behaves exactly as it did before rather than failing the invite. An
  // invitation that was created must never be rolled back because a message
  // could not be sent.
  let emailed = false
  try {
    const template = await previewNotificationTemplate(
      staff.orgId,
      'staff_invite',
      'email',
      'en'
    )

    const vars = {
      member_name: parsed.data.fullName,
      name: parsed.data.fullName,
      gym_name: staff.orgName,
      email: parsed.data.email,
    }
    const fill = (text: string | null) =>
      (text ?? '').replace(
        /\{\{([a-z_]+)\}\}/g,
        (_match, key: string) => (vars as Record<string, string>)[key] ?? ''
      )

    const messageId = await enqueueNotification({
      channel: 'email',
      event: 'staff_invite',
      to: parsed.data.email,
      subject: fill(template?.subject ?? null) || `You have been invited to ${staff.orgName}`,
      body: fill(template?.body ?? null),
      staffId: invited.id,
      dedupeKey: `staff_invite:${invited.id}`,
    })

    // A message is enqueued whether or not a gateway exists -- an org with no
    // email account gets a `skipped` row saying so. Read the status back rather
    // than assuming, because telling someone an email is on its way when none
    // is means they stop chasing.
    const { data: message } = await supabase
      .from('notification_messages')
      .select('status')
      .eq('id', messageId)
      .maybeSingle()

    emailed = message?.status === 'queued'
  } catch {
    // Same reasoning: the person is on the team either way.
  }

  revalidatePath('/staff')
  revalidatePath('/notifications')

  return {
    success: emailed
      ? `${parsed.data.fullName} was invited and an email is on its way to ${parsed.data.email}.`
      : `${parsed.data.fullName} was invited. They can sign up with ${parsed.data.email} to get in.`,
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
    .select('id, role, auth_user_id')
    .eq('id', parsed.data.staffId)
    .maybeSingle()

  if (!target) {
    return { error: 'That staff member could not be found.' }
  }

  if (target.role === 'owner' && actor.role !== 'owner') {
    return { error: 'Only an owner can change another owner.' }
  }

  // Reactivating someone who never signed up puts them back to "awaiting
  // signup", not "active": an active row with no account behind it looks
  // fine in the table and then cannot be linked or given a password.
  const status =
    parsed.data.status === 'active' && !target.auth_user_id ? 'invited' : parsed.data.status

  const { error } = await supabase
    .from('staff')
    .update({ status })
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

export async function updateStaffAssignment(
  _prevState: StaffFormState,
  formData: FormData
): Promise<StaffFormState> {
  const actor = await requireRole('owner', 'manager')

  const parsed = updateStaffAssignmentSchema.safeParse({
    staffId: formData.get('staffId'),
    role: formData.get('role'),
    branchIds: formData.getAll('branchIds').map(String),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  // The same ceiling inviteStaff applies: a manager staffs their own floor and
  // cannot create peers or superiors. RLS is the backstop; this states the rule.
  if (!assignableRoles(actor.role).includes(parsed.data.role)) {
    return { fieldErrors: { role: ['You cannot give someone that role.'] } }
  }

  if (parsed.data.staffId === actor.staffId) {
    return { error: 'You cannot change your own role or branches here.' }
  }

  // A manager may only assign branches they cover themselves.
  if (actor.role !== 'owner') {
    const outside = parsed.data.branchIds.filter((id) => !actor.branchIds.includes(id))
    if (outside.length > 0) {
      return { fieldErrors: { branchIds: ['You can only assign branches you work at.'] } }
    }
  }

  const supabase = await createClient()

  // Read the target first, same as setStaffStatus: none of the checks above
  // inspect the target's *current* role, so without this a manager aiming at
  // an owner or a peer manager would sail past every one of them, RLS would
  // then filter the update to zero rows, and -- with no .select() chained --
  // PostgREST reports that as success. Reading first turns that silent no-op
  // into a message.
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

  if (target.role === 'manager' && actor.role !== 'owner') {
    return { error: 'You cannot reassign another manager.' }
  }

  const { data: updated, error } = await supabase
    .from('staff')
    .update({
      role: parsed.data.role,
      branch_ids: parsed.data.role === 'owner' ? [] : parsed.data.branchIds,
    })
    .eq('id', parsed.data.staffId)
    // Without this, a zero-row RLS-filtered update returns no error and no
    // data, and the two checks above are the only things standing between
    // that and a false "Saved."
    .select('id')

  if (error) {
    // The guard trigger raises check_violation with a sentence worth showing.
    return { error: error.message }
  }

  if (!updated || updated.length === 0) {
    return { error: 'That staff member could not be updated.' }
  }

  revalidatePath('/staff')
  return { success: 'Saved. It takes effect the next time they sign in.' }
}

export async function resetStaffPassword(
  _prevState: StaffFormState,
  formData: FormData
): Promise<StaffFormState> {
  const actor = await requireRole('owner', 'manager')

  const parsed = resetStaffPasswordSchema.safeParse({
    staffId: formData.get('staffId'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  if (parsed.data.staffId === actor.staffId) {
    return { error: 'Change your own password from the sign-in page instead.' }
  }

  const supabase = await createClient()

  // The RLS-bound read is the authorisation step: it only returns a row from
  // the actor's own org. Everything below trusts auth_user_id because it came
  // from here, not from the form.
  const { data: target } = await supabase
    .from('staff')
    .select('id, role, status, auth_user_id, email, full_name')
    .eq('id', parsed.data.staffId)
    .eq('org_id', actor.orgId)
    .maybeSingle()

  if (!target) {
    return { error: 'That staff member could not be found.' }
  }

  // Same ceiling as reassignment: a manager staffs their own floor.
  if (!assignableRoles(actor.role).includes(target.role)) {
    return { error: 'You cannot reset that person\'s password.' }
  }

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return { error: 'Password resets are not configured on this server yet.' }
  }

  let authUserId = target.auth_user_id

  // An unlinked row means one of two things: they signed up but the link
  // never happened (a reactivated row used to block it), or they never signed
  // up at all. The RPC adopts an existing account by email and returns null
  // when there is none -- in which case the account is created here, with
  // this password, so "reset" doubles as "set up". Either way the row ends up
  // linked, and current_staff() can find them the next time they sign in.
  let created = false
  if (!authUserId) {
    const { data: linked, error: linkError } = await supabase.rpc(
      'link_staff_account_by_email',
      { p_staff_id: target.id }
    )
    if (linkError) {
      return { error: linkError.message }
    }
    authUserId = linked

    if (!authUserId) {
      const { data: account, error: createError } = await admin.auth.admin.createUser({
        email: target.email,
        password: parsed.data.password,
        email_confirm: true,
        user_metadata: { full_name: target.full_name },
      })
      if (createError) {
        return { error: createError.message }
      }
      created = true
      authUserId = account.user.id

      const { error: relinkError } = await supabase.rpc('link_staff_account_by_email', {
        p_staff_id: target.id,
      })
      if (relinkError) {
        return { error: relinkError.message }
      }
    }
  }

  // A row still marked "awaiting signup" is now signed up.
  if (target.status === 'invited') {
    await supabase
      .from('staff')
      .update({ status: 'active' })
      .eq('id', target.id)
      .eq('org_id', actor.orgId)
  }

  if (!created) {
    const { error } = await admin.auth.admin.updateUserById(authUserId, {
      password: parsed.data.password,
    })
    if (error) {
      return { error: error.message }
    }
  }

  revalidatePath('/staff')

  return {
    success: created
      ? `Account created. ${target.full_name} can sign in with ${target.email} and this password.`
      : 'Password changed. They can sign in with it straight away.',
  }
}
