'use client'

import { useEffect } from 'react'

/**
 * Opt-in one-click printing via ?auto=1.
 *
 * Waits on document.fonts.ready: firing print before Figtree and Geist have
 * settled prints a layout that reflows a moment later, which on A4 is the
 * difference between one page and two.
 */
export function AutoPrint() {
  useEffect(() => {
    let cancelled = false

    const ready = document.fonts?.ready ?? Promise.resolve()

    ready.then(() => {
      if (!cancelled) window.print()
    })

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
