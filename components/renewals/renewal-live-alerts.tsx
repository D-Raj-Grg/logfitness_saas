'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { renewalAlertMemberName } from '@/app/(app)/renewal-alert-actions'
import { createClient } from '@/lib/supabase/client'

/** Sonner would stack two toasts for one ask; one id is one toast per window. */
const DEDUPE_MS = 60_000
/** Realtime is down: refresh this often so the badge and card still catch up. */
const POLL_MS = 45_000
/**
 * An UPDATE also fires when the desk closes a request or edits a note. Only a
 * row asked for within this window is news; the re-ask path bumps
 * last_requested_at, so it still qualifies.
 */
const FRESH_MS = 2 * 60_000

type RequestPayload = {
  id?: string
  member_id?: string
  status?: string
  last_requested_at?: string
}

/**
 * Mounted once in the console shell for roles that serve members. Listens for
 * renewal_requests changes as the signed-in staff member -- RLS decides which
 * rows the socket is told about, so another branch's asks never arrive -- then
 * toasts "<name> asked to renew" and re-renders the server tree so the sidebar
 * badge and dashboard card move too. If the socket cannot be had it falls back
 * to refreshing every 45 s; it renders nothing.
 */
export function RenewalLiveAlerts() {
  const router = useRouter()
  // The effect must not re-subscribe when the router object changes identity.
  const routerRef = useRef(router)
  useEffect(() => {
    routerRef.current = router
  }, [router])

  useEffect(() => {
    const supabase = createClient()
    const recent = new Map<string, number>()
    let poll: ReturnType<typeof setInterval> | null = null
    let stopped = false

    const stopPolling = () => {
      if (poll) clearInterval(poll)
      poll = null
    }
    const startPolling = () => {
      if (poll || stopped) return
      poll = setInterval(() => {
        if (document.visibilityState === 'visible') routerRef.current.refresh()
      }, POLL_MS)
    }

    async function onChange(row: RequestPayload) {
      routerRef.current.refresh()

      if (row.status !== 'pending' || !row.id || !row.member_id) return
      const askedAt = row.last_requested_at ? Date.parse(row.last_requested_at) : NaN
      if (!Number.isFinite(askedAt) || Date.now() - askedAt > FRESH_MS) return

      const now = Date.now()
      for (const [key, at] of recent) if (now - at > DEDUPE_MS) recent.delete(key)
      if (recent.has(row.id)) return
      recent.set(row.id, now)

      const found = await renewalAlertMemberName(row.member_id).catch(() => null)
      if (stopped || !found) return

      const memberId = row.member_id
      toast(`${found.name} asked to renew`, {
        id: `renewal-${row.id}`,
        duration: 15_000,
        action: {
          label: 'Open',
          onClick: () => routerRef.current.push(`/members/${memberId}`),
        },
      })
    }

    const channel = supabase
      .channel('renewal-requests-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'renewal_requests' },
        (payload) => void onChange(payload.new as RequestPayload)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'renewal_requests' },
        (payload) => void onChange(payload.new as RequestPayload)
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') stopPolling()
        else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          startPolling()
        }
      })

    return () => {
      stopped = true
      stopPolling()
      void supabase.removeChannel(channel)
    }
  }, [])

  return null
}
