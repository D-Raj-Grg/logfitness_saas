import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { requireRole } from '@/lib/auth'
import { listSessionsToMark } from '@/lib/db/trainer-sessions'
import { formatDateTime, formatTime } from '@/lib/format'

import { markAttendanceAction } from './actions'

export default async function TrainerSessionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const staff = await requireRole('trainer', 'manager', 'owner')
  const params = await searchParams
  const error = typeof params.error === 'string' ? params.error : null

  const sessions = await listSessionsToMark({
    branchIds: staff.role === 'owner' ? null : staff.branchIds,
    trainerId: staff.role === 'trainer' ? staff.staffId : null,
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Mark attendance</h1>
        <p className="text-sm text-muted-foreground">
          Classes that have started in the last three days. Mark who showed up.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {sessions.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No classes to mark.
        </p>
      ) : (
        sessions.map((session) => (
          <section key={session.id} className="rounded-xl border">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b p-4">
              <div>
                <h2 className="font-medium">{session.classes?.name ?? 'Class'}</h2>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(session.starts_at)} - {formatTime(session.ends_at)}
                  {session.classes?.room ? ` - ${session.classes.room}` : ''}
                </p>
              </div>
              <span className="text-sm text-muted-foreground">
                {session.class_bookings.length} of {session.capacity} seats
              </span>
            </header>

            {session.class_bookings.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Nobody was booked.</p>
            ) : (
              <ul className="divide-y">
                {session.class_bookings.map((booking) => (
                  <li key={booking.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <p className="font-medium">{booking.members?.full_name}</p>
                      <p className="text-xs text-muted-foreground">{booking.members?.member_code}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {booking.status !== 'booked' ? (
                        <Badge variant={booking.status === 'attended' ? 'default' : 'secondary'}>
                          {booking.status === 'attended' ? 'Attended' : 'No-show'}
                        </Badge>
                      ) : null}
                      <form action={markAttendanceAction}>
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <input type="hidden" name="attended" value="yes" />
                        <Button type="submit" size="sm" variant={booking.status === 'attended' ? 'secondary' : 'default'}>
                          Attended
                        </Button>
                      </form>
                      <form action={markAttendanceAction}>
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <input type="hidden" name="attended" value="no" />
                        <Button type="submit" size="sm" variant="outline">
                          No-show
                        </Button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  )
}
