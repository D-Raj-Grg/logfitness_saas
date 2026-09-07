'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'

import { rememberBranchScope } from '@/app/(app)/scope-actions'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { BranchScope } from '@/lib/scope'

const ALL = '__all__'

export function BranchSwitcher({ scope }: { scope: BranchScope }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  if (!scope.canSwitch) return null

  // The layout resolves `scope` with empty search params (a layout has none
  // of its own), so `scope.selectedId` reflects the cookie fallback, not the
  // URL. On a fresh visit `searchParams` has no `branch` key, so without this
  // fallback the control would show "All branches" while the page below (which
  // *does* see the cookie) renders one branch. Prefer the URL when present;
  // fall back to the layout's cookie-aware resolution otherwise.
  const currentId = searchParams.get('branch') ?? scope.selectedId

  function onChange(value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    const branchId = value === ALL || value === null ? null : value

    if (branchId) params.set('branch', branchId)
    else params.delete('branch')

    // Any page-position parameter belongs to the branch that was on screen.
    params.delete('page')

    startTransition(async () => {
      await rememberBranchScope(branchId)
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  return (
    <Select value={currentId ?? ALL} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="h-8 w-[200px]" aria-label="Branch">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>
          {scope.options.length > 1 && scope.branchIds === null ? 'All branches' : 'All my branches'}
        </SelectItem>
        {scope.options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
