/**
 * Page-size constants, kept out of the client component that renders the
 * control. The query schemas are parsed on the server, and importing them from
 * a `'use client'` module makes the value a client reference the server cannot
 * read ("Attempted to call DEFAULT_PAGE_SIZE() from the server").
 */

/** What a list offers. The query schemas clamp to this range independently. */
export const PAGE_SIZES = [10, 25, 50, 100] as const

export const DEFAULT_PAGE_SIZE = 25
