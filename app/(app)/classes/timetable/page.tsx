import Link from 'next/link'

import { Timetable } from '@/components/classes/timetable'
import { buttonVariants } from '@/components/ui/button'
import { requireStaff } from '@/lib/auth'
import { listSessionsBetween } from '@/lib/db/class-sessions'
import { addDays, todayInTimezone } from '@/lib/format'
import { resolveBranchScope } from '@/lib/scope'
import { weekSchema } from '@/lib/validation/classes'

/** Monday on or before the given YYYY-MM-DD. */
function mondayOf(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDays(iso, -((dow + 6) % 7))
}

export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const staff = await requireStaff()
  const raw = await searchParams
  const scope = await resolveBranchScope(raw, staff)

  const week = weekSchema.safeParse(Array.isArray(raw.week) ? raw.week[0] : raw.week)
  const weekStart = mondayOf(week.success ? week.data : todayInTimezone())

  // Padded a day each side so a browser in another timezone still finds every
  // session that falls on a displayed local day.
  const sessions = await listSessionsBetween(
    `${addDays(weekStart, -1)}T00:00:00Z`,
    `${addDays(weekStart, 8)}T00:00:00Z`,
    scope.branchIds
  )

  const branchQs = scope.selectedId ? `&branch=${scope.selectedId}` : ''
  const href = (w: string) => `/classes/timetable?week=${w}${branchQs}`
  const desk = staff.role !== 'trainer'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Timetable</h1>
          <p className="text-sm text-muted-foreground">
            Week of {weekStart} · {scope.label}
            {staff.role === 'owner' || staff.role === 'manager'
              ? '. Drag a session to another slot to reschedule it.'
              : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={href(addDays(weekStart, -7))} className={buttonVariants({ variant: 'outline' })}>
            Previous
          </Link>
          <Link href={href(mondayOf(todayInTimezone()))} className={buttonVariants({ variant: 'outline' })}>
            This week
          </Link>
          <Link href={href(addDays(weekStart, 7))} className={buttonVariants({ variant: 'outline' })}>
            Next
          </Link>
          <Link href="/classes" className={buttonVariants({ variant: 'ghost' })}>
            Classes
          </Link>
        </div>
      </div>

      <Timetable
        key={weekStart + (scope.selectedId ?? '')}
        sessions={sessions}
        weekStart={weekStart}
        canReschedule={staff.role === 'owner' || staff.role === 'manager'}
        canBook={desk}
      />
    </div>
  )
}
