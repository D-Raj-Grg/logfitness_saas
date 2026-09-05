'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ABSENCE_BANDS, type AbsenceBand } from '@/lib/attendance'

const ALL = 'all'

/** The lengths of absence a manager actually asks about. */
export const MIN_DAYS_OPTIONS = [14, 30, 60, 90] as const

type Branch = { id: string; name: string }

/**
 * Every filter lives in the URL, so a call list can be bookmarked, printed, or
 * handed to whoever is making the calls as a link. `replace` rather than `push`
 * -- flipping between bands is a refinement, not a place in history.
 */
export function AbsentFilters({
  branchId,
  minDays,
  band,
  branches,
  allowAllBranches,
}: {
  branchId: string | null
  minDays: number
  band: AbsenceBand | null
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
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  const branchName = branchId
    ? (branches.find((branch) => branch.id === branchId)?.name ?? 'Branch')
    : 'All branches'

  return (
    <div className="flex flex-wrap items-end gap-4 print:hidden">
      <div className="flex flex-col gap-2">
        <Label htmlFor="absent-branch">Branch</Label>
        <Select
          value={branchId ?? ALL}
          onValueChange={(value) => navigate({ branch: String(value) })}
        >
          <SelectTrigger id="absent-branch" className="w-56">
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

      <div className="flex flex-col gap-2">
        <Label htmlFor="absent-min-days">Away for at least</Label>
        <Select
          value={String(minDays)}
          onValueChange={(value) =>
            // A longer threshold can strand the selected band -- drop it.
            navigate({ minDays: String(value), band: null })
          }
        >
          <SelectTrigger id="absent-min-days" className="w-40">
            <SelectValue>{minDays} days</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {MIN_DAYS_OPTIONS.map((value) => (
              <SelectItem key={value} value={String(value)}>
                {value} days
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="absent-band">Band</Label>
        <Select
          value={band ?? ALL}
          onValueChange={(value) => navigate({ band: String(value) })}
        >
          <SelectTrigger id="absent-band" className="w-44">
            <SelectValue>{band ?? 'Any length'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any length</SelectItem>
            {ABSENCE_BANDS.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
