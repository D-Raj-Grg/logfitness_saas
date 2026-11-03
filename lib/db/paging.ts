/**
 * A page number past the end of a paged list.
 *
 * PostgREST answers an offset beyond the row count with an error (PGRST103,
 * "Requested range not satisfiable"), which these queries would otherwise rethrow
 * as a 500. It happens on a stale bookmark after rows were deleted, or a page
 * number typed into the URL. The right answer is the last real page, not a crash.
 */
export function isRangeNotSatisfiable(error: { code?: string } | null | undefined) {
  return error?.code === 'PGRST103'
}

/** The 1-based last page for a total, never below 1. */
export function lastPageFor(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize))
}
