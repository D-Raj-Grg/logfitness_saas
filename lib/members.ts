import type { Database } from '@/lib/types/database'

export type MemberStatus = Database['public']['Enums']['member_status']
export type MembershipStatus = Database['public']['Enums']['membership_status']
export type PlanType = Database['public']['Enums']['plan_type']
export type PaymentMethod = Database['public']['Enums']['payment_method']
export type PaymentKind = Database['public']['Enums']['payment_kind']

/**
 * A refund is money handed back. A reversal is money that never arrived and
 * should not have been recorded. Both are negative rows; only the words tell
 * the drawer which happened, so they live here and nowhere else.
 */
export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  payment: 'Payment',
  refund: 'Refund',
  reversal: 'Never received',
}
export type DiscountReason = Database['public']['Enums']['discount_reason']

/**
 * Why money came off. A fixed list rather than free text so the same discount
 * reads the same on every invoice and can be totalled later -- "dashain",
 * "Dashain offer" and "festival discount" were three reasons in a text box.
 * 'other' carries a note, so the desk is never blocked by a case nobody
 * anticipated.
 */
export const DISCOUNT_REASON_LABELS: Record<DiscountReason, string> = {
  festival: 'Festival offer',
  student: 'Student',
  staff_referral: 'Staff referral',
  friend_referral: 'Friend referral',
  corporate: 'Corporate',
  other: 'Other',
}

export const DISCOUNT_REASONS = Object.keys(
  DISCOUNT_REASON_LABELS
) as DiscountReason[]

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

export type BadgeTone = 'default' | 'secondary' | 'destructive' | 'outline'

/** Tone for a membership row's own status. */
export function membershipStatusTone(status: MembershipStatus): BadgeTone {
  if (status === 'active') return 'default'
  if (status === 'upcoming') return 'outline'
  if (status === 'frozen') return 'secondary'
  return 'destructive'
}

/**
 * Badge tone for a member's status. Two of the tones are not statuses the
 * database stores. "Expiring" is an active membership within seven days of its
 * end. "Starts later" is a member whose only membership has not begun yet:
 * members.status has no 'upcoming' value, so a plan sold for tomorrow reads as
 * 'expired' until the nightly sweep promotes it. Neither is an alarm, so
 * neither is red.
 */
export function memberStatusTone(
  status: MemberStatus,
  daysToExpiry: number | null,
  membershipStatus?: MembershipStatus | null,
  hasMembershipHistory = true
): BadgeTone {
  // Never sold anything yet. The status underneath is 'expired' and every
  // report is right to count it that way, but on screen this is a registration
  // waiting for a plan, not a lapsed member -- so it reads neutral, not red.
  if (status === 'expired' && !hasMembershipHistory) return 'secondary'
  if (status === 'expired' && membershipStatus === 'upcoming') return 'outline'
  if (status === 'active' && daysToExpiry !== null && daysToExpiry <= 7) {
    return 'outline'
  }
  if (status === 'active') return 'default'
  if (status === 'frozen') return 'secondary'
  return 'destructive'
}
