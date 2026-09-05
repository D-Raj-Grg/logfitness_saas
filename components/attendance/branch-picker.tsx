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

const ALL = 'all'

type Branch = { id: string; name: string }

/**
 * The desk is a single-branch screen, so the branch lives in the URL rather
 * than in component state: a shift handover is then just a link, and the page
 * stays a Server Component.
 */
export function BranchPicker({
  branchId,
  branches,
  allowAllBranches,
}: {
  branchId: string | null
  branches: Branch[]
  allowAllBranches: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function choose(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === ALL) params.delete('branch')
    else params.set('branch', value)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  const branchName = branchId
    ? (branches.find((branch) => branch.id === branchId)?.name ?? 'Branch')
    : 'All branches'

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="check-in-branch">Branch</Label>
      <Select
        value={branchId ?? ALL}
        onValueChange={(value) => choose(String(value))}
      >
        <SelectTrigger id="check-in-branch" className="w-56">
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
  )
}
