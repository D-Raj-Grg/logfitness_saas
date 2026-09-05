import { requireStaff } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const staff = await requireStaff()

  const supabase = await createClient()
  const { data: branches } = await supabase
    .from('branches')
    .select('id, name, status')
    .order('name')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Good to see you, {staff.fullName}</h1>
        <p className="text-sm text-muted-foreground">
          {branches?.length ?? 0} branch
          {(branches?.length ?? 0) === 1 ? '' : 'es'} in {staff.orgName}
        </p>
      </div>

      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Members, memberships, and payments arrive in Phase 1. Until then this is
        the shell: authentication, tenant claims, and role-aware navigation.
      </div>
    </div>
  )
}
