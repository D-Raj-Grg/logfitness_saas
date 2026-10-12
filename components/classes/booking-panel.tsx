'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'

import {
  bookMember,
  cancelBooking,
  loadSessionBookings,
  searchMembersForBooking,
} from '@/app/(app)/classes/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SessionBooking } from '@/lib/db/class-sessions'

type Hit = { id: string; full_name: string; member_code: string; phone: string }

const STATUS_LABEL: Record<SessionBooking['status'], string> = {
  booked: 'Booked',
  waitlisted: 'Waitlisted',
  cancelled: 'Cancelled',
  attended: 'Attended',
  no_show: 'No show',
}

export function BookingPanel({
  sessionId,
  canBook,
  onChanged,
}: {
  sessionId: string
  canBook: boolean
  onChanged?: () => void
}) {
  const [loaded, setLoaded] = useState<{ sessionId: string; list: SessionBooking[] } | null>(null)
  const bookings = loaded?.sessionId === sessionId ? loaded.list : null
  const [term, setTerm] = useState('')
  const [found, setFound] = useState<Hit[]>([])
  const hits = term.trim().length < 2 ? [] : found
  const [pending, startTransition] = useTransition()

  const reload = useCallback(async () => {
    const result = await loadSessionBookings(sessionId)
    if (result.error) toast.error(result.error)
    setLoaded({ sessionId, list: result.bookings })
  }, [sessionId])

  useEffect(() => {
    let stale = false
    void loadSessionBookings(sessionId).then((result) => {
      if (stale) return
      if (result.error) toast.error(result.error)
      setLoaded({ sessionId, list: result.bookings })
    })
    return () => {
      stale = true
    }
  }, [sessionId])

  useEffect(() => {
    if (term.trim().length < 2) return
    let stale = false
    const timer = setTimeout(async () => {
      const result = await searchMembersForBooking(term)
      if (!stale) setFound(result.members as Hit[])
    }, 250)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [term])

  function book(member: Hit) {
    startTransition(async () => {
      const result = await bookMember({ sessionId, memberId: member.id })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.status === 'waitlisted'
          ? `${member.full_name} is on the waitlist (class is full).`
          : `${member.full_name} is booked.`
      )
      setTerm('')
      setFound([])
      await reload()
      onChanged?.()
    })
  }

  function cancel(booking: SessionBooking) {
    startTransition(async () => {
      const result = await cancelBooking({ bookingId: booking.id })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        result.promoted
          ? 'Cancelled. The next person on the waitlist was moved up.'
          : 'Booking cancelled.'
      )
      await reload()
      onChanged?.()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {canBook ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`member-search-${sessionId}`} className="text-sm font-medium">
            Book a member
          </label>
          <Input
            id={`member-search-${sessionId}`}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Name, phone or member code"
            autoComplete="off"
          />
          {hits.length > 0 ? (
            <ul className="divide-y rounded-md border">
              {hits.map((hit) => (
                <li key={hit.id} className="flex items-center justify-between gap-2 p-2 text-sm">
                  <span>
                    {hit.full_name}
                    <span className="block text-xs text-muted-foreground">
                      {hit.member_code} · {hit.phone}
                    </span>
                  </span>
                  <Button size="sm" disabled={pending} onClick={() => book(hit)}>
                    Book
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Bookings</h3>
        {bookings === null ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody booked yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {bookings.map((booking) => (
              <li key={booking.id} className="flex items-center justify-between gap-2 p-2 text-sm">
                <span>
                  {booking.member_name}
                  <span className="block text-xs text-muted-foreground">
                    {booking.member_code} · {booking.phone}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={booking.status === 'waitlisted' ? 'outline' : 'secondary'}>
                    {STATUS_LABEL[booking.status]}
                  </Badge>
                  {canBook && (booking.status === 'booked' || booking.status === 'waitlisted') ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => cancel(booking)}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
