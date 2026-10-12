'use client'

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { rescheduleSession } from '@/app/(app)/classes/actions'
import { BookingPanel } from '@/components/classes/booking-panel'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { TimetableSession } from '@/lib/db/class-sessions'
import { cn } from '@/lib/utils'

const DAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function SessionCard({
  session,
  draggable,
  onOpen,
}: {
  session: TimetableSession
  draggable: boolean
  onOpen: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: session.id,
    disabled: !draggable,
  })
  const full = session.booked_count >= session.capacity
  const cancelled = session.status === 'cancelled'

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onOpen}
      {...attributes}
      {...(draggable ? listeners : {})}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cn(
        'w-full rounded-md border bg-card p-2 text-left text-xs shadow-xs',
        draggable && 'cursor-grab touch-none',
        isDragging && 'relative z-20 opacity-80 shadow-md',
        cancelled && 'opacity-50 line-through'
      )}
    >
      <span className="block font-medium">{session.class_name}</span>
      <span className="block text-muted-foreground">
        {TIME_FMT.format(new Date(session.starts_at))} - {TIME_FMT.format(new Date(session.ends_at))}
      </span>
      <span className={cn('block', full ? 'text-destructive' : 'text-muted-foreground')}>
        {session.booked_count}/{session.capacity}
        {full ? ' full' : ''}
        {session.room ? ` · ${session.room}` : ''}
      </span>
    </button>
  )
}

function Cell({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={cn('flex min-h-12 flex-col gap-1 border-t p-1', isOver && 'bg-accent')}
    >
      {children}
    </div>
  )
}

export function Timetable({
  sessions: initial,
  weekStart,
  canReschedule,
  canBook,
}: {
  sessions: TimetableSession[]
  /** ISO date (YYYY-MM-DD) of the first day shown. */
  weekStart: string
  canReschedule: boolean
  canBook: boolean
}) {
  const router = useRouter()
  const [sessions, setSessions] = useState(initial)
  const [openId, setOpenId] = useState<string | null>(null)
  const [seen, setSeen] = useState(initial)
  if (seen !== initial) {
    setSeen(initial)
    setSessions(initial)
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const days = useMemo(() => {
    const [y, m, d] = weekStart.split('-').map(Number)
    return Array.from({ length: 7 }, (_, i) => new Date(y, m - 1, d + i))
  }, [weekStart])

  const hours = useMemo(() => {
    let lo = 6
    let hi = 21
    for (const s of sessions) {
      const h = new Date(s.starts_at).getHours()
      lo = Math.min(lo, h)
      hi = Math.max(hi, h)
    }
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
  }, [sessions])

  async function onDragEnd(event: DragEndEvent) {
    if (!event.over) return
    const session = sessions.find((s) => s.id === event.active.id)
    if (!session) return
    const [dayIndex, hour] = String(event.over.id).split('-').map(Number)
    const day = days[dayIndex]
    const oldStart = new Date(session.starts_at)
    const duration = new Date(session.ends_at).getTime() - oldStart.getTime()
    const newStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, oldStart.getMinutes())
    if (newStart.getTime() === oldStart.getTime()) return

    const next = { ...session, starts_at: newStart.toISOString(), ends_at: new Date(newStart.getTime() + duration).toISOString() }
    const previous = sessions
    setSessions((current) => current.map((s) => (s.id === session.id ? next : s)))

    const result = await rescheduleSession({
      sessionId: session.id,
      startsAt: next.starts_at,
      endsAt: next.ends_at,
    })
    if (result.error) {
      setSessions(previous)
      toast.error(result.error)
      return
    }
    toast.success(`${session.class_name} moved to ${DAY_FMT.format(newStart)}, ${TIME_FMT.format(newStart)}.`)
    router.refresh()
  }

  const open = sessions.find((s) => s.id === openId) ?? null

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="overflow-x-auto">
          <div className="grid min-w-[56rem] grid-cols-7 rounded-lg border">
            {days.map((day, dayIndex) => (
              <div key={dayIndex} className="border-r last:border-r-0">
                <div className="p-2 text-center text-sm font-medium">{DAY_FMT.format(day)}</div>
                {hours.map((hour) => {
                  const inCell = sessions.filter((s) => {
                    const start = new Date(s.starts_at)
                    return sameDay(start, day) && start.getHours() === hour
                  })
                  return (
                    <Cell key={hour} id={`${dayIndex}-${hour}`}>
                      {inCell.length === 0 ? (
                        <span className="text-[10px] text-muted-foreground/60">{hour}:00</span>
                      ) : (
                        inCell.map((s) => (
                          <SessionCard
                            key={s.id}
                            session={s}
                            draggable={canReschedule}
                            onOpen={() => setOpenId(s.id)}
                          />
                        ))
                      )}
                    </Cell>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </DndContext>

      <Sheet open={open !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="overflow-y-auto p-4 sm:max-w-md">
          {open ? (
            <>
              <SheetHeader className="p-0">
                <SheetTitle>{open.class_name}</SheetTitle>
                <SheetDescription>
                  {DAY_FMT.format(new Date(open.starts_at))}, {TIME_FMT.format(new Date(open.starts_at))} -{' '}
                  {TIME_FMT.format(new Date(open.ends_at))} · {open.booked_count}/{open.capacity} booked
                </SheetDescription>
              </SheetHeader>
              <BookingPanel
                sessionId={open.id}
                canBook={canBook && open.status === 'scheduled'}
                onChanged={() => router.refresh()}
              />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}
