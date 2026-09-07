import Link from 'next/link'

import { PageSizeSelect } from '@/components/app/page-size-select'
import { Button } from '@/components/ui/button'

export function Pagination({
  basePath,
  page,
  pageSize,
  total,
  params,
}: {
  /** The list's own route, so Prev/Next stay on it. */
  basePath: string
  page: number
  pageSize: number
  total: number
  /** Current query params, so Prev/Next keep the search and filters. */
  params: Record<string, string | undefined>
}) {
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
    return encoded ? `${basePath}?${encoded}` : basePath
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
      {/* The row count is offered even on an empty list: "no results" and "no
          results in the first 10" read the same, and the fix for the second is
          this control. */}
      <div className="flex items-center gap-4">
        <PageSizeSelect pageSize={pageSize} />
        <span>
          {total === 0 ? 'Nothing to show' : `Showing ${first}–${last} of ${total}`}
        </span>
      </div>

      {total === 0 ? null : (
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
      )}
    </div>
  )
}
