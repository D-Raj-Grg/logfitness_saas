import { Badge } from '@/components/ui/badge'
import {
  MEMBER_STATUS_LABELS,
  MEMBERSHIP_STATUS_LABELS,
  memberStatusTone,
  type MemberStatus,
  type MembershipStatus,
} from '@/lib/members'

export function memberStatusLabel(
  status: MemberStatus,
  daysToExpiry: number | null,
  membershipStatus?: MembershipStatus | null
) {
  // A plan sold for a future date leaves members.status at 'expired' until the
  // nightly sweep starts it, so the membership row is the honest label here.
  if (status === 'expired' && membershipStatus === 'upcoming') {
    return MEMBERSHIP_STATUS_LABELS.upcoming
  }
  if (status === 'active' && daysToExpiry !== null && daysToExpiry <= 7) {
    if (daysToExpiry <= 0) return 'Expires today'
    return `Expiring in ${daysToExpiry} day${daysToExpiry === 1 ? '' : 's'}`
  }
  return MEMBER_STATUS_LABELS[status]
}

export function MemberStatusBadge({
  status,
  daysToExpiry,
  membershipStatus,
  className,
}: {
  status: MemberStatus
  daysToExpiry: number | null
  /** Status of the member's current membership row, when the caller has it. */
  membershipStatus?: MembershipStatus | null
  className?: string
}) {
  return (
    <Badge
      variant={memberStatusTone(status, daysToExpiry, membershipStatus)}
      className={className}
    >
      {memberStatusLabel(status, daysToExpiry, membershipStatus)}
    </Badge>
  )
}
