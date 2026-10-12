import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { BookingPanel } from '@/components/classes/booking-panel'
import { requireStaff } from '@/lib/auth'
import { getSession } from '@/lib/db/class-sessions'
import { formatDateTime, formatTime } from '@/lib/format'

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const staff = await requireStaff()
  const { sessionId } = await params
  if (!z.uuid().safeParse(sessionId).success) notFound()

  const session = await getSession(sessionId)
  if (!session) notFound()

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <Link href="/classes/timetable" className="text-sm text-muted-foreground hover:underline">
          Back to timetable
        </Link>
        <h1 className="text-2xl font-semibold">{session.class_name}</h1>
        <p className="text-sm text-muted-foreground">
          {formatDateTime(session.starts_at)} - {formatTime(session.ends_at)} ·{' '}
          {session.booked_count}/{session.capacity} booked
          {session.room ? ` · ${session.room}` : ''}
          {session.status === 'cancelled' ? ' · Cancelled' : ''}
        </p>
      </div>
      <BookingPanel
        sessionId={session.id}
        canBook={staff.role !== 'trainer' && session.status === 'scheduled'}
      />
    </div>
  )
}
