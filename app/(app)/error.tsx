'use client'

import { useEffect } from 'react'

import { Button } from '@/components/ui/button'

/**
 * Catches a failed render inside the console shell -- most often a query that
 * threw because RLS returned nothing the page could use. The sidebar stays put,
 * so the screen is still navigable and one bad report does not strand the shift.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack, which is not
    // shipped to the browser.
    console.error('Console route failed', error.digest, error)
  }, [error])

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
      <p className="text-sm font-medium">This screen could not load</p>
      <p className="max-w-md text-sm text-muted-foreground">
        The data behind it did not come back. Trying again usually clears it; if
        it does not, the reference below will identify the failure in the logs.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">{error.digest}</p>
      ) : null}
      <Button variant="outline" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
