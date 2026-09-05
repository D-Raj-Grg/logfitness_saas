import { Badge } from '@/components/ui/badge'
import { MEMBER_STATUS_LABELS, memberStatusTone, type MemberStatus } from '@/lib/members'

export function memberStatusLabel(status: MemberStatus, daysToExpiry: number | null) {
  if (status === 'active' && daysToExpiry !== null && daysToExpiry <= 7) {
    if (daysToExpiry <= 0) return 'Expires today'
    return `Expiring in ${daysToExpiry} day${daysToExpiry === 1 ? '' : 's'}`
  }
  return MEMBER_STATUS_LABELS[status]
}

export function MemberStatusBadge({
  status,
  daysToExpiry,
  className,
}: {
  status: MemberStatus
  daysToExpiry: number | null
  className?: string
}) {
  return (
    <Badge variant={memberStatusTone(status, daysToExpiry)} className={className}>
      {memberStatusLabel(status, daysToExpiry)}
    </Badge>
  )
}
