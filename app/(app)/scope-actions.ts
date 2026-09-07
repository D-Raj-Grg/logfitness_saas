'use server'

import { cookies } from 'next/headers'

import { BRANCH_SCOPE_COOKIE } from '@/lib/scope'

/**
 * Remembers the last branch chosen so the next session opens where the user
 * left off. Deliberately not validated against the caller's branches: it is
 * read back only through resolveBranchScope, which checks membership before
 * honouring it, and RLS bounds the query either way.
 */
export async function rememberBranchScope(branchId: string | null) {
  const cookieStore = await cookies()

  if (branchId) {
    cookieStore.set(BRANCH_SCOPE_COOKIE, branchId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 90,
    })
  } else {
    cookieStore.delete(BRANCH_SCOPE_COOKIE)
  }
}
