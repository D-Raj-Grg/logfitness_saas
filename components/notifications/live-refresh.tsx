'use client'

import { useEffect, useState } from 'react'

import { useRouter } from 'next/navigation'

/**
 * Keeps the delivery log current while anything is still moving.
 *
 * A message sits in `sending` for up to a minute -- the outbox cron hands it to
 * the gateway on one tick and reads the reply on the next -- so the row that
 * matters is precisely the one that is wrong by the time the page has finished
 * rendering. Rather than ask for a refresh, the table re-fetches itself on a
 * timer for as long as something is in flight, and stops the moment nothing is.
 *
 * `router.refresh()` re-runs the server component and diffs the result, so the
 * scroll position, the filters and any open menu all survive it.
 */
export function LiveRefresh({
  pending,
  intervalMs = 8000,
  /** Stops a forgotten tab polling all afternoon over a message that is stuck. */
  maxMinutes = 15,
}: {
  pending: number
  intervalMs?: number
  maxMinutes?: number
}) {
  const router = useRouter()
  const [expired, setExpired] = useState(false)

  const live = pending > 0 && !expired

  useEffect(() => {
    // Nothing in flight, or the timer has already given up: no polling either
    // way. Giving up is undone by the button below, not by an effect, so this
    // never sets state on its own.
    if (pending === 0 || expired) return

    const started = Date.now()
    const timer = setInterval(() => {
      if (Date.now() - started > maxMinutes * 60_000) {
        setExpired(true)
        return
      }
      router.refresh()
    }, intervalMs)

    // A tab that was in the background is stale the moment it comes back.
    const onFocus = () => router.refresh()
    window.addEventListener('focus', onFocus)

    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [pending, expired, intervalMs, maxMinutes, router])

  if (pending === 0) return null

  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span
        aria-hidden
        className={
          'size-1.5 rounded-full ' +
          (live ? 'animate-pulse bg-sky-500' : 'bg-muted-foreground/40')
        }
      />
      {live ? (
        <>
          {pending} still moving — this list updates itself
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            setExpired(false)
            router.refresh()
          }}
          className="underline underline-offset-4"
        >
          Stopped checking. Check again
        </button>
      )}
    </span>
  )
}
