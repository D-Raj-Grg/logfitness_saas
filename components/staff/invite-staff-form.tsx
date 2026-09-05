'use client'

import { useActionState, useState } from 'react'

import { inviteStaff, type StaffFormState } from '@/app/(app)/staff/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ROLE_LABELS, type StaffRole } from '@/lib/roles'

type Branch = { id: string; name: string }

/** Owners may appoint other owners; managers may not. */
function assignableRoles(actorRole: StaffRole): StaffRole[] {
  return actorRole === 'owner'
    ? ['owner', 'manager', 'front_desk', 'trainer']
    : ['front_desk', 'trainer']
}

function branchHint(role: StaffRole) {
  if (role === 'owner') return 'Owners see every branch, so there is nothing to assign.'
  if (role === 'manager') return 'Pick every branch this manager runs.'
  return 'Pick the one branch they work at.'
}

export function InviteStaffForm({
  actorRole,
  branches,
}: {
  actorRole: StaffRole
  branches: Branch[]
}) {
  const [state, formAction, pending] = useActionState<StaffFormState, FormData>(
    inviteStaff,
    {}
  )
  const [role, setRole] = useState<StaffRole>('front_desk')
  const [selected, setSelected] = useState<string[]>([])

  const roles = assignableRoles(actorRole)
  const singleBranch = role === 'front_desk' || role === 'trainer'

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
    <Card>
      <CardHeader>
        <CardTitle>Invite a colleague</CardTitle>
        <CardDescription>
          They sign up with this email address and land straight in your gym.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <AuthFormMessage error={state.error} notice={state.success} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName">Name</Label>
              <Input id="fullName" name="fullName" required />
              <FieldError messages={state.fieldErrors?.fullName} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
              <FieldError messages={state.fieldErrors?.email} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input id="phone" name="phone" inputMode="tel" />
              <FieldError messages={state.fieldErrors?.phone} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="role">Role</Label>
              <Select
                name="role"
                value={role}
                onValueChange={(value) => changeRole(value as StaffRole)}
              >
                <SelectTrigger id="role" className="w-full">
                  <SelectValue />
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

          <div>
            <Button type="submit" disabled={pending}>
              {pending ? 'Inviting...' : 'Send invitation'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
