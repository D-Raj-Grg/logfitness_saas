import { notFound } from 'next/navigation'

import { OrgLetterheadForm } from '@/components/settings/org-letterhead-form'
import { requireRole } from '@/lib/auth'
import { getOrgProfile } from '@/lib/db/orgs'
import { orgLogoUrl } from '@/lib/org-logo'

export default async function SettingsPage() {
  // Owner-only for clarity; "owners update their own org" is the enforcement.
  const staff = await requireRole('owner')

  const org = await getOrgProfile(staff.orgId)
  if (!org) notFound()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          The gym&apos;s own details, as they appear on printed documents.
        </p>
      </div>

      <OrgLetterheadForm org={org} logoUrl={orgLogoUrl(org.logo_path)} />
    </div>
  )
}
