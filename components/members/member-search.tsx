'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Branch = { id: string; name: string }

const ALL = 'all'

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: ALL, label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'expiring', label: 'Expiring in 7 days' },
  { value: 'expired', label: 'Expired' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'dues', label: 'Dues outstanding' },
  { value: 'left', label: 'Left' },
]

export function MemberSearch({
  q,
  status,
  branchId,
  branches,
}: {
  q: string
  status?: string
  branchId?: string
  branches: Branch[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [term, setTerm] = useState(q)
  const lastPushed = useRef(q)

  // Filters are URL state so the page stays a Server Component and results
  // are shareable. Every change resets to page 1 -- the old offset is
  // meaningless against a new result set.
  function replaceParams(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    params.delete('page')
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
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
    STATUS_OPTIONS.find((option) => option.value === (status ?? ALL))?.label ??
    'All statuses'
  const branchLabel =
    branches.find((branch) => branch.id === branchId)?.name ?? 'All branches'

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-64 flex-1 flex-col gap-1.5">
        <Label htmlFor="member-search">Search</Label>
        <Input
          id="member-search"
          type="search"
          placeholder="Phone, name, or member code"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="flex w-48 flex-col gap-1.5">
        <Label htmlFor="member-status">Status</Label>
        <Select
          value={status ?? ALL}
          onValueChange={(value) =>
            replaceParams({ status: value === ALL ? undefined : String(value) })
          }
        >
          <SelectTrigger id="member-status" className="w-full">
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

      {branches.length > 1 ? (
        <div className="flex w-48 flex-col gap-1.5">
          <Label htmlFor="member-branch">Branch</Label>
          <Select
            value={branchId ?? ALL}
            onValueChange={(value) =>
              replaceParams({ branchId: value === ALL ? undefined : String(value) })
            }
          >
            <SelectTrigger id="member-branch" className="w-full">
              <SelectValue>{branchLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All branches</SelectItem>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </div>
  )
}
