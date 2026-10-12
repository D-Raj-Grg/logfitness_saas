import type { Database } from '@/lib/types/database'

export type AttendanceMethod = Database['public']['Enums']['attendance_method']

/**
 * The word the check-in screen shouts. Computed in Postgres by
 * public.attendance_banner() so the Flutter app gets the same verdict; this
 * union is the TypeScript mirror of that function's output.
 */
export type CheckInBanner =
  | 'active'
  | 'expiring'
  | 'expired'
  | 'frozen'
  | 'upcoming'
  | 'none'
  | 'left'

export const ATTENDANCE_METHOD_LABELS: Record<AttendanceMethod, string> = {
  manual: 'Front desk',
  qr: 'QR code',
  card: 'Card',
  biometric: 'Biometric',
}

/**
 * Who let the member in, for the attendance tables. A desk check-in names the
 * staff member; a card tap has no person behind it (checked_in_by is null), so
 * it names the reader instead. An owner's check-in can also have neither.
 */
export function attendanceActorLabel(row: {
  checked_in_by_name: string | null
  device_name: string | null
}) {
  if (row.checked_in_by_name) return row.checked_in_by_name
  if (row.device_name) return `Device · ${row.device_name}`
  return '--'
}

export const BANNER_LABELS: Record<CheckInBanner, string> = {
  active: 'Active member',
  expiring: 'Expiring soon',
  expired: 'Membership expired',
  frozen: 'Membership frozen',
  upcoming: 'Membership starts later',
  none: 'No membership on file',
  left: 'Member has left',
}

/**
 * What the desk should do about it, in one line. The front desk is the moment a
 * renewal gets sold, so every non-active verdict names the next action.
 */
export const BANNER_ADVICE: Record<CheckInBanner, string> = {
  active: 'Let them in.',
  expiring: 'Let them in, and offer the renewal now.',
  expired: 'Renew before letting them train.',
  frozen: 'Membership is on hold — unfreeze it to resume.',
  upcoming: 'Their plan has not started yet.',
  none: 'Sell a plan before letting them train.',
  left: 'This member is marked as left. Reactivate them first.',
}

/** Green means walk in; amber means sell; red means stop. */
export function bannerTone(banner: CheckInBanner): 'ok' | 'warn' | 'stop' {
  if (banner === 'active') return 'ok'
  if (banner === 'expiring' || banner === 'upcoming') return 'warn'
  return 'stop'
}

export function bannerBadgeVariant(
  banner: CheckInBanner
): 'default' | 'secondary' | 'destructive' | 'outline' {
  const tone = bannerTone(banner)
  if (tone === 'ok') return 'default'
  if (tone === 'warn') return 'outline'
  return 'destructive'
}

/**
 * Absence bands for the churn report. Kept beside the labels rather than in a
 * client component so Server Components can import them without a boundary.
 */
export const ABSENCE_BANDS = ['14-29 days', '30-59 days', '60+ days'] as const
export type AbsenceBand = (typeof ABSENCE_BANDS)[number]

/** How long someone has been in the building, spoken the way staff say it. */
export function formatMinutesIn(minutes: number) {
  const safe = Math.max(0, Math.round(minutes))
  if (safe < 60) return `${safe} min`

  const hours = Math.floor(safe / 60)
  const rest = safe % 60
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`
}
