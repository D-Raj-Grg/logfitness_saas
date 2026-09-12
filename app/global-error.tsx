'use client'

/**
 * The last resort: a failure in the root layout itself, where the console shell
 * and its styles are not available. It replaces the whole document, so it ships
 * its own html/body and leans on inline styles rather than Tailwind.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
          fontFamily: 'system-ui, sans-serif',
          color: '#14181f',
        }}
      >
        <div style={{ maxWidth: '28rem', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1rem', fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ fontSize: '0.875rem', color: '#5b6472' }}>
            The application failed to start. Reload the page to try again.
          </p>
          {error.digest ? (
            <p style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#5b6472' }}>
              {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              borderRadius: '0.5rem',
              border: '1px solid #c9ced6',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  )
}
