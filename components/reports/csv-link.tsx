'use client'

import { useSearchParams } from 'next/navigation'

/**
 * A plain `<a>`, not `next/link` -- this is a download, not a navigation. It
 * copies every current search param onto `/api/reports/<report>/csv` so the
 * exported file matches whatever the screen is currently scoped and filtered
 * to (branch, period, bucket, band, the collection day) rather than always
 * exporting the caller's default view.
 */
export function CsvLink({ report }: { report: string }) {
  const searchParams = useSearchParams()
  const query = searchParams.toString()
  const href = `/api/reports/${report}/csv${query ? `?${query}` : ''}`

  return (
    <a
      href={href}
      className="text-sm font-medium text-primary underline-offset-4 hover:underline print:hidden"
    >
      Export CSV
    </a>
  )
}
