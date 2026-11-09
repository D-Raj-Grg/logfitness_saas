'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

import { Spinner } from '@/components/app/spinner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { CardStockFilter } from '@/lib/validation/cards'

const ALL: CardStockFilter = 'all'

const STATUS_OPTIONS: { value: CardStockFilter; label: string }[] = [
  { value: 'all', label: 'All cards' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'free', label: 'Free' },
  { value: 'unlinked', label: 'Free, no chip yet' },
  { value: 'lost', label: 'Lost' },
  { value: 'retired', label: 'Retired' },
]

export function CardStockSearch({ q, status }: { q: string; status: CardStockFilter }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [term, setTerm] = useState(q)
  const lastPushed = useRef(q)
  const [pending, startTransition] = useTransition()

  // Filters are URL state so the page stays a Server Component and results
  // are shareable. Every change resets to page 1.
  function replaceParams(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    params.delete('page')
    const query = params.toString()
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname)
    })
  }

  useEffect(() => {
    if (term === lastPushed.current) return
    const timer = setTimeout(() => {
      lastPushed.current = term
      replaceParams({ q: term.trim() || undefined })
    }, 300)
    return () => clearTimeout(timer)
    // replaceParams reads the latest params on each call; re-running on its
    // identity would restart the debounce on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term])

  const statusLabel =
    STATUS_OPTIONS.find((option) => option.value === status)?.label ?? 'All cards'

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-64 flex-1 flex-col gap-1.5">
        <Label htmlFor="card-search">Search</Label>
        <div className="relative">
          <Input
            id="card-search"
            type="search"
            placeholder="Card number, holder, member code, or chip UID"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            autoComplete="off"
            className="pr-9"
          />
          {pending ? (
            <Spinner label="Searching cards" className="absolute top-1/2 right-3 -translate-y-1/2" />
          ) : null}
        </div>
      </div>

      <div className="flex w-48 flex-col gap-1.5">
        <Label htmlFor="card-status">Status</Label>
        <Select
          value={status}
          onValueChange={(value) =>
            replaceParams({ status: value === ALL ? undefined : String(value) })
          }
        >
          <SelectTrigger id="card-status" className="w-full">
            <SelectValue>{statusLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
