'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const ALL = 'all'

export const VISITOR_VIEWS = {
  open: 'To call back',
  all: 'Everyone',
  converted: 'Joined',
  lost: 'Not joining',
} as const

export type VisitorView = keyof typeof VISITOR_VIEWS

const KIND_FILTERS = {
  all: 'Enquiries and guests',
  enquiry: 'Enquiries only',
  guest: 'Guests only',
} as const

/**
 * Filters live in the URL, like the absent-members list: a call list is
 * something you bookmark or hand to whoever is making the calls.
 */
export function VisitorFilters({
  view,
  kind,
  q,
}: {
  view: VisitorView
  kind: keyof typeof KIND_FILTERS
  q: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function navigate(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    // Any change to what is being listed starts again at page one: page five of
    // "to call back" is not page five of "everyone".
    params.delete('page')
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '' || value === ALL) params.delete(key)
      else params.set(key, value)
    }
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="visitor-view">Show</Label>
        <Select value={view} onValueChange={(value) => navigate({ view: String(value) })}>
          <SelectTrigger id="visitor-view" className="w-48">
            <SelectValue>{VISITOR_VIEWS[view]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(VISITOR_VIEWS) as VisitorView[]).map((value) => (
              <SelectItem key={value} value={value}>
                {VISITOR_VIEWS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="visitor-kind">Kind</Label>
        <Select value={kind} onValueChange={(value) => navigate({ kind: String(value) })}>
          <SelectTrigger id="visitor-kind" className="w-52">
            <SelectValue>{KIND_FILTERS[kind]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(KIND_FILTERS) as (keyof typeof KIND_FILTERS)[]).map((value) => (
              <SelectItem key={value} value={value}>
                {KIND_FILTERS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          const value = new FormData(event.currentTarget).get('q')
          navigate({ q: typeof value === 'string' ? value.trim() : null })
        }}
      >
        <Label htmlFor="visitor-q">Search</Label>
        {/* Uncontrolled and keyed on the URL: the box follows the back button
            without a state-syncing effect. */}
        <Input
          key={q}
          id="visitor-q"
          name="q"
          defaultValue={q}
          placeholder="Name or mobile"
          className="w-56"
        />
      </form>
    </div>
  )
}
