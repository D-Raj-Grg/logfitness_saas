'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import {
  adjustMembershipDates as adjustMembershipDatesRow,
  cancelMembership as cancelMembershipRow,
  freezeMembership as freezeMembershipRow,
  renewMembership as renewMembershipRow,
  unfreezeMembership as unfreezeMembershipRow,
} from '@/lib/db/memberships'
import {
  recordPayment as recordPaymentRow,
  refundPayment as refundPaymentRow,
  reversePayment as reversePaymentRow,
} from '@/lib/db/payments'
import { listPlansForBranch } from '@/lib/db/plans'
import { formatDate, formatMoney } from '@/lib/format'
import {
  adjustMembershipDatesSchema,
  cancelMembershipSchema,
  freezeMembershipSchema,
  membershipIdSchema,
  recordPaymentSchema,
  refundPaymentSchema,
  renewMembershipSchema,
  reversePaymentSchema,
} from '@/lib/validation/payments'

export type MembershipActionState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[]>
  /**
   * Set when the action produced something worth handing over on paper, so the
   * panel can offer the print view while the desk still has the member there.
   */
  document?: { href: string; label: string }
}

const CASHIER_ROLES = ['owner', 'manager', 'front_desk'] as const

/**
 * The RPCs raise with a sentence meant for the person at the desk. PostgREST
 * sometimes prefixes it with the SQLSTATE ("P0001: ..."), which is noise here.
 */
function rpcErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : null
  if (!message) return fallback
  return message.replace(/^[A-Z0-9]{5}:\s*/, '')
}

function revalidateMember(memberId: string) {
  revalidatePath(`/members/${memberId}`)
  revalidatePath('/members/[id]', 'page')
  revalidatePath('/members')
  revalidatePath('/payments')
  revalidatePath('/')
}

function optional(formData: FormData, key: string) {
  const value = formData.get(key)
  return value === null ? undefined : String(value)
}

/**
 * Plans on sale at one branch, for the renew dialog to swap in as the branch
 * changes. A read, but exposed as an action so the panel needs no route.
 */
export async function loadPlansForBranch(branchId: string) {
  const staff = await requireRole(...CASHIER_ROLES)

  const parsed = z.uuid().safeParse(branchId)
  if (!parsed.success) return { plans: [] }

  if (staff.role !== 'owner' && !staff.branchIds.includes(parsed.data)) {
    return { plans: [] }
  }

  const plans = await listPlansForBranch(parsed.data)
  return {
    plans: plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      plan_type: plan.plan_type,
      duration_days: plan.duration_days,
      session_count: plan.session_count,
      price_paisa: plan.price_paisa,
      signup_fee_paisa: plan.signup_fee_paisa,
    })),
  }
}

export async function renewMembership(
  _prevState: MembershipActionState,
  formData: FormData
): Promise<MembershipActionState> {
  const staff = await requireRole(...CASHIER_ROLES)

  const parsed = renewMembershipSchema.safeParse({
    memberId: formData.get('memberId'),
    planId: formData.get('planId'),
    branchId: formData.get('branchId'),
    startDate: optional(formData, 'startDate'),
    discountPaisa: optional(formData, 'discountPaisa'),
    amountPaidPaisa: optional(formData, 'amountPaidPaisa'),
    method: formData.get('method') ?? undefined,
    referenceNo: optional(formData, 'referenceNo'),
    notes: optional(formData, 'notes'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  // RLS would reject the insert anyway, but as an opaque policy error. Saying
  // it here keeps the message on the field that caused it.
  if (staff.role !== 'owner' && !staff.branchIds.includes(parsed.data.branchId)) {
    return { fieldErrors: { branchId: ['You can only sell at your own branch.'] } }
  }

  let result: Awaited<ReturnType<typeof renewMembershipRow>>
  try {
    result = await renewMembershipRow({
      memberId: parsed.data.memberId,
      planId: parsed.data.planId,
      branchId: parsed.data.branchId,
      startDate: parsed.data.startDate,
      discountPaisa: parsed.data.discountPaisa,
      amountPaidPaisa: parsed.data.amountPaidPaisa,
      method: parsed.data.method,
      referenceNo: parsed.data.referenceNo,
      notes: parsed.data.notes,
    })
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The membership could not be sold.') }
  }

  revalidateMember(parsed.data.memberId)

  const due =
    result.due_paisa > 0
      ? `${formatMoney(result.due_paisa)} still due.`
      : 'Paid in full.'

  return {
    success: `Invoice ${result.invoice_no} raised for ${formatMoney(result.total_paisa)}. ${due}`,
    document: { href: `/invoices/${result.invoice_id}/print`, label: 'Print invoice' },
  }
}

export async function recordPayment(
  _prevState: MembershipActionState,
  formData: FormData
): Promise<MembershipActionState> {
  await requireRole(...CASHIER_ROLES)

  const memberId = z.uuid().safeParse(formData.get('memberId'))

  const parsed = recordPaymentSchema.safeParse({
    invoiceId: formData.get('invoiceId'),
    amountPaisa: formData.get('amountPaisa'),
    method: formData.get('method') ?? undefined,
    referenceNo: optional(formData, 'referenceNo'),
    notes: optional(formData, 'notes'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  let result: Awaited<ReturnType<typeof recordPaymentRow>>
  try {
    result = await recordPaymentRow(parsed.data)
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The payment could not be recorded.') }
  }

  if (memberId.success) revalidateMember(memberId.data)

  return {
    success:
      result.due_paisa > 0
        ? `${formatMoney(parsed.data.amountPaisa)} recorded. ${formatMoney(result.due_paisa)} still due.`
        : `${formatMoney(parsed.data.amountPaisa)} recorded. Invoice settled.`,
    document: { href: `/receipts/${result.payment_id}/print`, label: 'Print receipt' },
  }
}

export async function refundPayment(
  _prevState: MembershipActionState,
  formData: FormData
): Promise<MembershipActionState> {
  await requireRole(...CASHIER_ROLES)

  const memberId = z.uuid().safeParse(formData.get('memberId'))

  const parsed = refundPaymentSchema.safeParse({
    paymentId: formData.get('paymentId'),
    amountPaisa: formData.get('amountPaisa'),
    reason: formData.get('reason'),
    method: formData.get('method') ?? undefined,
    referenceNo: optional(formData, 'referenceNo'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  let refund: Awaited<ReturnType<typeof refundPaymentRow>>
  try {
    refund = await refundPaymentRow(parsed.data)
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The refund could not be recorded.') }
  }

  if (memberId.success) revalidateMember(memberId.data)

  return {
    success: `${formatMoney(parsed.data.amountPaisa)} refunded.`,
    document: {
      href: `/receipts/${refund.refund_id}/print`,
      label: 'Print refund receipt',
    },
  }
}

export async function freezeMembership(
  _prevState: MembershipActionState,
  formData: FormData
): Promise<MembershipActionState> {
  await requireRole(...CASHIER_ROLES)

  const memberId = z.uuid().safeParse(formData.get('memberId'))

  const parsed = freezeMembershipSchema.safeParse({
    membershipId: formData.get('membershipId'),
    notes: optional(formData, 'notes'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  try {
    await freezeMembershipRow(parsed.data.membershipId, parsed.data.notes)
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The membership could not be frozen.') }
  }

  if (memberId.success) revalidateMember(memberId.data)

  return { success: 'Membership frozen. The clock stops until it is unfrozen.' }
}

export async function unfreezeMembership(
  _prevState: MembershipActionState,
  formData: FormData
): Promise<MembershipActionState> {
  await requireRole(...CASHIER_ROLES)

  const memberId = z.uuid().safeParse(formData.get('memberId'))

  const parsed = membershipIdSchema.safeParse({
    membershipId: formData.get('membershipId'),
  })

  if (!parsed.success) {
    return { error: 'That membership could not be found.' }
  }

  let result: Awaited<ReturnType<typeof unfreezeMembershipRow>>
  try {
    result = await unfreezeMembershipRow(parsed.data.membershipId)
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The membership could not be unfrozen.') }
  }

  if (memberId.success) revalidateMember(memberId.data)

  const days = result.paused_days
  return {
    success:
      days > 0
        ? `Membership active again. End date moved out by ${days} day${days === 1 ? '' : 's'}.`
        : 'Membership active again.',
  }
}

export async function cancelMembership(
  _prevState: MembershipActionState,
  formData: FormData
): Promise<MembershipActionState> {
  await requireRole(...CASHIER_ROLES)

  const memberId = z.uuid().safeParse(formData.get('memberId'))

  const parsed = cancelMembershipSchema.safeParse({
    membershipId: formData.get('membershipId'),
    reason: formData.get('reason'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  try {
    await cancelMembershipRow(parsed.data.membershipId, parsed.data.reason)
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The membership could not be cancelled.') }
  }

  if (memberId.success) revalidateMember(memberId.data)

  return { success: 'Membership cancelled.' }
}


/**
 * Moving -- or correcting -- the window of a membership already sold. Owners
 * and managers only, checked here so the button can be hidden and again inside
 * the RPC, which is what the Flutter app will hit.
 */
export async function adjustMembershipDates(
  _prevState: MembershipActionState,
  formData: FormData
): Promise<MembershipActionState> {
  await requireRole('owner', 'manager')

  const memberId = z.uuid().safeParse(formData.get('memberId'))

  const parsed = adjustMembershipDatesSchema.safeParse({
    membershipId: formData.get('membershipId'),
    startDate: formData.get('startDate'),
    endDate: optional(formData, 'endDate') || undefined,
    reason: formData.get('reason'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  let result: Awaited<ReturnType<typeof adjustMembershipDatesRow>>
  try {
    result = await adjustMembershipDatesRow(parsed.data)
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The dates could not be changed.') }
  }

  if (memberId.success) revalidateMember(memberId.data)

  // Two separate facts, and the desk cares about both: where it runs now, and
  // whether the member ended up with more or fewer days than they paid for.
  const moved = result.days_moved
  const changed = result.days_changed
  const term = changed - moved

  const window = result.end_date
    ? `Runs ${formatDate(result.start_date)} to ${formatDate(result.end_date)}.`
    : `Starts ${formatDate(result.start_date)}.`

  const movement =
    moved !== 0
      ? ` Pushed back ${Math.abs(moved)} day${Math.abs(moved) === 1 ? '' : 's'}${
          term === 0 ? ', same length' : ''
        }.`
      : ''

  const length =
    term !== 0
      ? ` ${term > 0 ? 'Gained' : 'Lost'} ${Math.abs(term)} day${Math.abs(term) === 1 ? '' : 's'}.`
      : ''

  return { success: `${window}${movement}${length}` }
}


/**
 * The payment that was rung up but never handed over. Owner and manager only,
 * checked here and again in the RPC; the front desk records money, it does not
 * decide that money never came.
 */
export async function reversePayment(
  _prevState: MembershipActionState,
  formData: FormData
): Promise<MembershipActionState> {
  await requireRole('owner', 'manager')

  const memberId = z.uuid().safeParse(formData.get('memberId'))

  const parsed = reversePaymentSchema.safeParse({
    paymentId: formData.get('paymentId'),
    reason: formData.get('reason'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  let result: Awaited<ReturnType<typeof reversePaymentRow>>
  try {
    result = await reversePaymentRow(parsed.data)
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The payment could not be reversed.') }
  }

  if (memberId.success) revalidateMember(memberId.data)

  return {
    success:
      result.invoice_no && result.due_paisa !== null
        ? `Reversed. Invoice ${result.invoice_no} owes ${formatMoney(result.due_paisa)} again.`
        : 'Reversed. The payment no longer counts against the drawer.',
  }
}
