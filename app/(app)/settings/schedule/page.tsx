import Link from 'next/link'
import { notFound } from 'next/navigation'

import { HolidaysSection, WeeklyOffForm } from '@/components/settings/gym-schedule-forms'
import { requireRole } from '@/lib/auth'
import { listOrgHolidays } from '@/lib/db/org-schedule'
import { getOrgProfile } from '@/lib/db/orgs'
import { readWeeklyOff } from '@/lib/schedule'

export default async function GymSchedulePage() {
  // Owner and manager: the database enforces the same pair on every write.
  const staff = await requireRole('owner', 'manager')

  const [org, holidays] = await Promise.all([getOrgProfile(staff.orgId), listOrgHolidays()])
  if (!org) notFound()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={staff.role === 'owner' ? '/settings' : '/'}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {staff.role === 'owner' ? 'Settings' : 'Dashboard'}
        </Link>
        <h1 className="text-2xl font-semibold">Gym schedule</h1>
        <p className="text-sm text-muted-foreground">
          The days the gym is closed. Members&apos; attendance calendar shows these days as off
          instead of absent.
        </p>
      </div>

      <WeeklyOffForm weeklyOff={readWeeklyOff(org.settings)} />
      <HolidaysSection holidays={holidays} />
    </div>
  )
}
