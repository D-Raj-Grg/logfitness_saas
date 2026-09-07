import { cookies } from 'next/headers'

import { listBranches } from '@/lib/db/branches'
import type { CurrentStaff } from '@/lib/roles'

export const BRANCH_SCOPE_COOKIE = 'lg_branch'

export type BranchOption = { id: string; name: string }

export type BranchScope = {
  /** null = every branch RLS allows. Never an empty array for a real caller. */
  branchIds: string[] | null
  /** null = the aggregate view. */
  selectedId: string | null
  label: string
  options: BranchOption[]
  canSwitch: boolean
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Which branches the caller is looking at.
 *
 * The `branch` search parameter is a FILTER, never a permission: RLS decides
 * what the query can see, and a forged id simply falls back to the caller's
 * default scope rather than erroring. A stale bookmark is not an attack, and it
 * should not produce a dead screen.
 */
export async function resolveBranchScope(
  searchParams: Record<string, string | string[] | undefined>,
  staff: CurrentStaff
): Promise<BranchScope> {
  const branches = await listBranches()
  const isOwner = staff.role === 'owner'

  // An owner covers the org; everyone else covers the branches on their staff
  // row. RLS agrees, so this only decides what the switcher may offer.
  const covered = isOwner
    ? branches
    : branches.filter((branch) => staff.branchIds.includes(branch.id))

  const options: BranchOption[] = covered.map((branch) => ({
    id: branch.id,
    name: branch.name,
  }))

  const canSwitch = options.length > 1

  const cookieStore = await cookies()
  const requested =
    first(searchParams.branch) ?? (canSwitch ? cookieStore.get(BRANCH_SCOPE_COOKIE)?.value : undefined)

  const selected = options.find((option) => option.id === requested) ?? null

  if (selected) {
    return {
      branchIds: [selected.id],
      selectedId: selected.id,
      label: selected.name,
      options,
      canSwitch,
    }
  }

  // The aggregate. An owner passes null so RLS alone bounds the query -- that
  // also covers a branch created after this request started. Everyone else
  // passes their own list, because "all" means "all of mine".
  return {
    branchIds: isOwner ? null : options.map((option) => option.id),
    selectedId: null,
    label: isOwner ? 'All branches' : canSwitch ? 'All my branches' : (options[0]?.name ?? 'No branch'),
    options,
    canSwitch,
  }
}
