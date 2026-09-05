import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'

export type PaymentRow = Database['public']['Tables']['payments']['Row']
export type PaymentMethod = Database['public']['Enums']['payment_method']

function unwrap<T>(result: { data: unknown; error: { message: string; code?: string } | null }) {
  if (result.error) throw result.error
  return result.data as T
}

/** Payments and refunds for one member, newest first. */
export async function listPaymentsForMember(memberId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('payments')
    .select('*, collector:staff!payments_collected_by_fkey(full_name)')
    .eq('member_id', memberId)
    .order('paid_at', { ascending: false })

  if (error) throw error
  return data
}

export async function recordPayment(args: {
  invoiceId: string
  amountPaisa: number
  method?: PaymentMethod
  referenceNo?: string | null
  notes?: string | null
}) {
  const supabase = await createClient()

  return unwrap<{
    payment_id: string
    invoice_id: string
    paid_paisa: number
    due_paisa: number
    status: Database['public']['Enums']['invoice_status']
  }>(
    await supabase.rpc('record_payment', {
      p_invoice_id: args.invoiceId,
      p_amount_paisa: args.amountPaisa,
      p_method: args.method ?? 'cash',
      p_reference_no: args.referenceNo ?? undefined,
      p_notes: args.notes ?? undefined,
    })
  )
}

export async function refundPayment(args: {
  paymentId: string
  amountPaisa: number
  reason: string
  method?: PaymentMethod
  referenceNo?: string | null
}) {
  const supabase = await createClient()

  return unwrap<{ refund_id: string; amount_paisa: number }>(
    await supabase.rpc('refund_payment', {
      p_payment_id: args.paymentId,
      p_amount_paisa: args.amountPaisa,
      p_reason: args.reason,
      p_method: args.method ?? undefined,
      p_reference_no: args.referenceNo ?? undefined,
    })
  )
}

/** The drawer sheet: one row per branch, collector, method, and kind. */
export async function dailyCollection(args: { on?: string; branchId?: string } = {}) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('daily_collection', {
    p_on: args.on ?? undefined,
    p_branch_id: args.branchId ?? undefined,
  })

  if (error) throw error
  return data
}

export async function arrearsReport(branchId?: string) {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('arrears_report', {
    p_branch_id: branchId ?? undefined,
  })

  if (error) throw error
  return data
}
