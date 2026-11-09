'use client'

// The public balance page has no staff session and no console chrome; when
// something breaks, the member should see one plain line, not the console's
// error screen.
export default function PublicError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load this card right now. Please try again in a moment, or ask at the
        front desk.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
      >
        Try again
      </button>
    </main>
  )
}
