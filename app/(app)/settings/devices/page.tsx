import { DevicesTable } from '@/components/settings/devices-table'
import { RegisterDeviceForm } from '@/components/settings/register-device-form'
import { requireRole } from '@/lib/auth'
import { listBranches } from '@/lib/db/branches'
import { listDevices } from '@/lib/db/devices'

export default async function DeviceSettingsPage() {
  // Managers set up the reader at their own door, so this page is open to them
  // even though the rest of /settings is owner-only; they reach it from the
  // check-in screen. The RPCs repeat both checks -- role and branch reach.
  const staff = await requireRole('owner', 'manager')
  const scopeBranchIds = staff.role === 'owner' ? null : staff.branchIds

  const [devices, branches] = await Promise.all([
    listDevices(scopeBranchIds),
    listBranches(),
  ])

  const branchNames = Object.fromEntries(branches.map((branch) => [branch.id, branch.name]))
  const registrable = branches.filter(
    (branch) =>
      branch.status === 'active' && (!scopeBranchIds || scopeBranchIds.includes(branch.id))
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Devices</h1>
        <p className="text-sm text-muted-foreground">
          RFID readers at the door. A member taps their card and is checked in if their
          membership is active and nothing is owed.
        </p>
      </div>

      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        A reader signs in with its own key, not a staff account. The key is shown once,
        when it is created; only a fingerprint of it is stored. A card tapped on a reader
        that belongs to nobody yet waits on the member profile, under Access card, to be
        assigned.
      </div>

      <RegisterDeviceForm branches={registrable} />

      <DevicesTable rows={devices} branchNames={branchNames} />
    </div>
  )
}
