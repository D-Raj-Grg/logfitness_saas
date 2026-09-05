import type { Database } from '@/lib/types/database'

export type MemberStatus = Database['public']['Enums']['member_status']
export type MembershipStatus = Database['public']['Enums']['membership_status']
export type PlanType = Database['public']['Enums']['plan_type']
export type PaymentMethod = Database['public']['Enums']['payment_method']
export type PaymentKind = Database['public']['Enums']['payment_kind']
export type InvoiceStatus = Database['public']['Enums']['invoice_status']
export type MemberGender = Database['public']['Enums']['member_gender']

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  active: 'Active',
  expired: 'Expired',
  frozen: 'Frozen',
  left: 'Left',
}

export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  upcoming: 'Starts later',
  active: 'Active',
  frozen: 'Frozen',
  expired: 'Expired',
  cancelled: 'Cancelled',
}

export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  time: 'Time-based',
  session_pack: 'Session pack',
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  esewa: 'eSewa',
  khalti: 'Khalti',
  fonepay: 'FonePay',
  bank: 'Bank transfer',
  card: 'Card',
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  unpaid: 'Unpaid',
  partial: 'Part paid',
  paid: 'Paid',
  void: 'Void',
}

export const GENDER_LABELS: Record<MemberGender, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
}

/** Digital rails are push payments; the reference is what reconciles them. */
export const methodNeedsReference = (method: PaymentMethod) => method !== 'cash'

/**
 * Badge tone for a member's status. "Expiring" is not a status the database
 * stores -- it is an active membership within seven days of its end -- so it is
 * derived here from the overview row.
 */
export function memberStatusTone(
  status: MemberStatus,
  daysToExpiry: number | null
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active' && daysToExpiry !== null && daysToExpiry <= 7) {
    return 'outline'
  }
  if (status === 'active') return 'default'
  if (status === 'frozen') return 'secondary'
  return 'destructive'
}
