'use client'

import { useActionState, useState } from 'react'

import { quickUpdateMember, type MemberFormState } from '@/app/(app)/members/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type QuickEditBranch = { id: string; name: string }

export type QuickEditMember = {
  id: string
  member_code: string
  full_name: string
  phone: string
  email: string | null
  home_branch_id: string
}

/**
 * Correcting a typo without leaving the list. The four fields the list itself
 * shows and the desk gets wrong most -- a misheard name, a transposed digit,
 * the wrong branch on a walk-in. Everything else lives on the full edit
 * screen, one click away in the same menu.
 */
export function MemberQuickEdit({
  member,
  branches,
  open,
  onOpenChange,
}: {
  member: QuickEditMember
  /** Branches this staff member may move someone into, already role-narrowed. */
  branches: QuickEditBranch[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted only while open, so an abandoned edit leaves nothing behind:
            reopening starts from what the row says now, not the old draft. */}
        {open ? (
          <QuickEditForm member={member} branches={branches} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function QuickEditForm({
  member,
  branches,
  onDone,
}: {
  member: QuickEditMember
  branches: QuickEditBranch[]
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<MemberFormState, FormData>(
    async (prev, formData) => {
      const result = await quickUpdateMember(prev, formData)
      if (result.success) onDone()
      return result
    },
    {}
  )

  const [branchId, setBranchId] = useState(member.home_branch_id)

  const branchName = branches.find((branch) => branch.id === branchId)?.name

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="memberId" value={member.id} />
      <input type="hidden" name="homeBranchId" value={branchId} />

      <DialogHeader>
        <DialogTitle>Quick edit</DialogTitle>
        <DialogDescription>
          {member.member_code} &middot; membership, payments and photo are on the full
          profile.
        </DialogDescription>
      </DialogHeader>

      <AuthFormMessage error={state.error} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="quick-name">Full name</Label>
        <Input
          id="quick-name"
          name="fullName"
          defaultValue={member.full_name}
          required
          maxLength={120}
          autoComplete="off"
        />
        <FieldError messages={state.fieldErrors?.fullName} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="quick-phone">Phone</Label>
          <Input
            id="quick-phone"
            name="phone"
            type="tel"
            defaultValue={member.phone}
            required
            maxLength={32}
            autoComplete="off"
          />
          <FieldError messages={state.fieldErrors?.phone} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="quick-email">Email</Label>
          <Input
            id="quick-email"
            name="email"
            type="email"
            defaultValue={member.email ?? ''}
            maxLength={254}
            autoComplete="off"
          />
          <FieldError messages={state.fieldErrors?.email} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="quick-branch">Home branch</Label>
        <Select value={branchId} onValueChange={(value) => setBranchId(String(value))}>
          <SelectTrigger id="quick-branch" className="w-full">
            <SelectValue>{branchName ?? 'Pick a branch'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {branches.map((branch) => (
              <SelectItem key={branch.id} value={branch.id}>
                {branch.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError messages={state.fieldErrors?.homeBranchId} />
      </div>

      <DialogFooter>
        <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  )
}
