'use client'

import { useActionState, useEffect, useState } from 'react'

import { updateStaffAssignment, type StaffFormState } from '@/app/(app)/staff/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ROLE_LABELS, assignableRoles, type StaffRole } from '@/lib/roles'
import type { StaffListRow } from '@/components/staff/staff-table'

type Branch = { id: string; name: string }

function branchHint(role: StaffRole) {
  if (role === 'owner') return 'Owners see every branch, so there is nothing to assign.'
  if (role === 'manager') return 'Pick every branch this manager runs.'
  return 'Pick the one branch they work at.'
}

function EditStaffForm({
  row,
  actorRole,
  branches,
  onSaved,
}: {
  row: StaffListRow
  actorRole: StaffRole
  branches: Branch[]
  onSaved: () => void
}) {
  const [state, formAction, pending] = useActionState<StaffFormState, FormData>(
    updateStaffAssignment,
    {}
  )
  const [role, setRole] = useState<StaffRole>(row.role)
  const [selected, setSelected] = useState<string[]>(row.branch_ids)

  const roles = assignableRoles(actorRole)
  const singleBranch = role === 'front_desk' || role === 'trainer'

  useEffect(() => {
    if (state.success) onSaved()
  }, [state, onSaved])

  function toggleBranch(branchId: string, checked: boolean) {
    setSelected((current) => {
      if (!checked) return current.filter((id) => id !== branchId)
      // Front desk and trainers hold exactly one branch, so a second choice
      // replaces the first instead of stacking. The database enforces this too.
      return singleBranch ? [branchId] : [...current, branchId]
    })
  }

  function changeRole(value: StaffRole) {
    setRole(value)
    // Owners are org-wide, and a role switch can invalidate the current picks.
    setSelected((current) =>
      value === 'owner' ? [] : current.slice(0, value === 'manager' ? current.length : 1)
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="staffId" value={row.id} />

      <AuthFormMessage error={state.error} notice={state.success} />

      <div className="flex flex-col gap-2">
        <Label htmlFor={`role-${row.id}`}>Role</Label>
        <Select
          name="role"
          value={role}
          onValueChange={(value) => changeRole(value as StaffRole)}
        >
          <SelectTrigger id={`role-${row.id}`} className="w-full">
            {/* Without children the trigger shows the raw enum value. */}
            <SelectValue>{ROLE_LABELS[role]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {roles.map((value) => (
              <SelectItem key={value} value={value}>
                {ROLE_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError messages={state.fieldErrors?.role} />
      </div>

      {role !== 'owner' ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Branches</legend>
          <p className="text-sm text-muted-foreground">{branchHint(role)}</p>
          <div className="flex flex-col gap-2">
            {branches.map((branch) => (
              <label key={branch.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selected.includes(branch.id)}
                  onCheckedChange={(checked) => toggleBranch(branch.id, checked)}
                />
                {branch.name}
              </label>
            ))}
          </div>
          {selected.map((id) => (
            <input key={id} type="hidden" name="branchIds" value={id} />
          ))}
          <FieldError messages={state.fieldErrors?.branchIds} />
        </fieldset>
      ) : null}

      <p className="text-sm text-muted-foreground">
        A role change takes effect the next time they sign in.
      </p>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}

export function EditStaffDialog({
  row,
  actorRole,
  actorBranchIds,
  branches,
}: {
  row: StaffListRow
  actorRole: StaffRole
  actorBranchIds: string[]
  branches: Branch[]
}) {
  const [open, setOpen] = useState(false)

  // A manager can only ever hand out branches they work at themselves.
  const assignableBranches =
    actorRole === 'owner' ? branches : branches.filter((b) => actorBranchIds.includes(b.id))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Edit</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {row.full_name}</DialogTitle>
          <DialogDescription>
            Change their role and which branches they work at.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed so a reopened dialog starts from the row, not stale state. */}
        {open ? (
          <EditStaffForm
            key={row.id}
            row={row}
            actorRole={actorRole}
            branches={assignableBranches}
            onSaved={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
