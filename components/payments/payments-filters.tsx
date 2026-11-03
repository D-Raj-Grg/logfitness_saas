'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { ARREARS_BUCKETS, type ArrearsBucket } from '@/components/payments/arrears-buckets'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { addDays } from '@/lib/format'

export type PaymentsView = 'collection' | 'arrears'

const ALL = 'all'

const QUICK_RANGES = [
  { label: 'Today', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
]

type Branch = { id: string; name: string }

/**
 * Every filter lives in the URL so a sheet can be bookmarked, printed, or
 * handed to the next shift as a link. The page re-fetches on navigation.
 */
export function PaymentsFilters({
  view,
  on,
  to,
  today,
  branchId,
  bucket,
  branches,
  allowAllBranches,
}: {
  view: PaymentsView
  on: string
  /** End of the collection window; equals `on` for a single day. */
  to: string
  /** The org's today, for the quick ranges. */
  today: string
  branchId: string | null
  bucket: ArrearsBucket | null
  branches: Branch[]
  allowAllBranches: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function navigate(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '' || value === ALL) params.delete(key)
      else params.set(key, value)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  const branchName = branchId
    ? (branches.find((branch) => branch.id === branchId)?.name ?? 'Branch')
    : 'All branches'

  return (
    <div className="flex flex-col gap-4 print:hidden">
      <Tabs value={view} onValueChange={(value) => navigate({ view: String(value) })}>
        <TabsList>
          <TabsTrigger value="collection">Daily collection</TabsTrigger>
          <TabsTrigger value="arrears">Arrears</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-end gap-4">
        {view === 'collection' ? (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="collection-date">From</Label>
              <Input
                id="collection-date"
                type="date"
                value={on}
                max={to}
                onChange={(event) => navigate({ on: event.target.value })}
                className="w-44"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="collection-date-to">To</Label>
              <Input
                id="collection-date-to"
                type="date"
                value={to}
                min={on}
                onChange={(event) => navigate({ to: event.target.value })}
                className="w-44"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {QUICK_RANGES.map((range) => (
                <Button
                  key={range.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const end = today
                    navigate({ on: addDays(end, -(range.days - 1)), to: range.days === 1 ? null : end })
                  }}
                >
                  {range.label}
                </Button>
              ))}
            </div>
          </>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor="payments-branch">Branch</Label>
          <Select
            value={branchId ?? ALL}
            onValueChange={(value) => navigate({ branch: String(value) })}
          >
            <SelectTrigger id="payments-branch" className="w-56">
              <SelectValue>{branchName}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {allowAllBranches ? <SelectItem value={ALL}>All branches</SelectItem> : null}
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {view === 'arrears' ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="arrears-bucket">Age</Label>
            <Select
              value={bucket ?? ALL}
              onValueChange={(value) => navigate({ bucket: String(value) })}
            >
              <SelectTrigger id="arrears-bucket" className="w-40">
                <SelectValue>{bucket ? `${bucket} days` : 'Any age'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any age</SelectItem>
                {ARREARS_BUCKETS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
    </div>
  )
}
