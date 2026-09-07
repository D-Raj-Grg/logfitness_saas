'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** What a list offers. The query schemas clamp to this range independently. */
export const PAGE_SIZES = [10, 25, 50, 100] as const

export const DEFAULT_PAGE_SIZE = 25

/**
 * How many rows a list shows. Lives in the URL like every other filter, so a
 * link keeps it -- and resets to page one, because page seven of 10-row pages
 * is nowhere near page seven of 100-row ones.
 */
export function PageSizeSelect({ pageSize }: { pageSize: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function choose(value: string | null) {
    const size = Number(value)
    if (!PAGE_SIZES.includes(size as (typeof PAGE_SIZES)[number])) return

    const params = new URLSearchParams(searchParams.toString())
    params.delete('page')
    if (size === DEFAULT_PAGE_SIZE) params.delete('pageSize')
    else params.set('pageSize', String(size))

    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  return (
    <label className="flex items-center gap-2">
      <span className="whitespace-nowrap">Rows</span>
      <Select value={String(pageSize)} onValueChange={choose}>
        <SelectTrigger size="sm" className="w-20" aria-label="Rows per page">
          <SelectValue>{pageSize}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZES.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
