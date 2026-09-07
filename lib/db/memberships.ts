import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type MembershipRow = Database['public']['Tables']['memberships']['Row']
export type InvoiceRow = Database['public']['Tables']['invoices']['Row']
export type PaymentMethod = Database['public']['Enums']['payment_method']

type RpcResult = Record<string, string | number | null>

function unwrap<T>(result: { data: unknown; error: { message: string; code?: string } | null }) {
  if (result.error) throw result.error
  return result.data as T
}

/** Newest first. This is the history strip on the member profile. */
export async function listMembershipsForMember(memberId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('memberships')
    .select('*')
    .eq('member_id', memberId)
    .order('start_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function listInvoicesForMember(memberId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('member_id', memberId)
    .order('issued_on', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

// Every write below is a single Postgres RPC, so the membership, its invoice,
// and any payment either all land or none do. See supabase/migrations for the
// function bodies; these are thin, typed wrappers.

export async function renewMembership(args: {
  memberId: string
  planId: string
  branchId: string
  startDate?: string | null
  discountPaisa?: number
  amountPaidPaisa?: number
  method?: PaymentMethod
  referenceNo?: string | null
  notes?: string | null
}) {
  const supabase = await createClient()

  return unwrap<{
    membership_id: string
    invoice_id: string
    invoice_no: string
    payment_id: string | null
    start_date: string
    end_date: string | null
    total_paisa: number
    due_paisa: number
  }>(
    await supabase.rpc('renew_membership', {
      p_member_id: args.memberId,
      p_plan_id: args.planId,
      p_branch_id: args.branchId,
      p_start_date: args.startDate ?? undefined,
      p_discount_paisa: args.discountPaisa ?? 0,
      p_amount_paid_paisa: args.amountPaidPaisa ?? 0,
      p_method: args.method ?? 'cash',
      p_reference_no: args.referenceNo ?? undefined,
      p_notes: args.notes ?? undefined,
    })
  )
}

export async function freezeMembership(membershipId: string, notes?: string | null) {
  const supabase = await createClient()
  return unwrap<RpcResult>(
    await supabase.rpc('freeze_membership', {
      p_membership_id: membershipId,
      p_notes: notes ?? undefined,
    })
  )
}

export async function unfreezeMembership(membershipId: string) {
  const supabase = await createClient()
  return unwrap<{ membership_id: string; paused_days: number; end_date: string | null }>(
    await supabase.rpc('unfreeze_membership', { p_membership_id: membershipId })
  )
}

/**
 * The window moves; the sale does not. Plan, price, discount and branch are
 * still refused by guard_membership_immutability, and the start date only moves
 * through this RPC, only before anyone has checked in against it.
 */
export async function adjustMembershipDates(args: {
  membershipId: string
  startDate: string
  endDate: string | null
  reason: string
}) {
  const supabase = await createClient()

  return unwrap<{
    membership_id: string
    member_id: string
    previous_start_date: string
    previous_end_date: string | null
    start_date: string
    end_date: string | null
    days_moved: number
    days_changed: number
    status: Database['public']['Enums']['membership_status']
  }>(
    await supabase.rpc('adjust_membership_dates', {
      p_membership_id: args.membershipId,
      p_start_date: args.startDate,
      // A session pack sold without a validity window genuinely has no end
      // date, and the RPC takes a null for it. The generated Args type has no
      // way to say that -- a date argument with no default reads as non-null.
      p_end_date: args.endDate as string,
      p_reason: args.reason,
    })
  )
}

export async function cancelMembership(membershipId: string, reason: string) {
  const supabase = await createClient()
  return unwrap<RpcResult>(
    await supabase.rpc('cancel_membership', {
      p_membership_id: membershipId,
      p_reason: reason,
    })
  )
}

export async function setMemberLeft(memberId: string, reason?: string | null) {
  const supabase = await createClient()
  return unwrap<RpcResult>(
    await supabase.rpc('set_member_left', {
      p_member_id: memberId,
      p_reason: reason ?? undefined,
    })
  )
}

export async function reactivateMember(memberId: string) {
  const supabase = await createClient()
  return unwrap<RpcResult>(
    await supabase.rpc('reactivate_member', { p_member_id: memberId })
  )
}
