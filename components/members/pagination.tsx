import Link from 'next/link'

import { Button } from '@/components/ui/button'

export function Pagination({
  page,
  pageSize,
  total,
  params,
}: {
  page: number
  pageSize: number
  total: number
  /** Current query params, so Prev/Next keep the search and filters. */
  params: Record<string, string | undefined>
}) {
  if (total === 0) return null

  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  function href(target: number) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, value)
    }
    if (target > 1) query.set('page', String(target))
    else query.delete('page')
    const encoded = query.toString()
    return encoded ? `/members?${encoded}` : '/members'
  }

  return (
    <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
      <span>
        Showing {first}–{last} of {total}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Button variant="outline" size="sm" render={<Link href={href(page - 1)} />}>
            Previous
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
        )}
        <span className="tabular-nums">
          Page {page} of {lastPage}
        </span>
        {page < lastPage ? (
          <Button variant="outline" size="sm" render={<Link href={href(page + 1)} />}>
            Next
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            Next
          </Button>
        )}
      </div>
    </div>
  )
}
