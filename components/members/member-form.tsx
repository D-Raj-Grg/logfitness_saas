'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'

import {
  createMember,
  updateMember,
  type MemberFormState,
} from '@/app/(app)/members/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { MemberRow } from '@/lib/db/members'
import { GENDER_LABELS, type MemberGender } from '@/lib/members'

type Branch = { id: string; name: string }

const NO_GENDER = 'unspecified'

export function MemberForm({
  member,
  branches,
}: {
  /** When present the form edits this member instead of registering one. */
  member?: MemberRow
  /** Branches the caller may register into -- already narrowed by role. */
  branches: Branch[]
}) {
  const editing = Boolean(member)
  const [state, formAction, pending] = useActionState<MemberFormState, FormData>(
    editing ? updateMember : createMember,
    {}
  )
  const [branchId, setBranchId] = useState<string>(
    member?.home_branch_id ?? (branches.length === 1 ? branches[0].id : '')
  )
  const [gender, setGender] = useState<string>(member?.gender ?? NO_GENDER)

  const branchName = branches.find((branch) => branch.id === branchId)?.name

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editing ? 'Edit details' : 'New member'}</CardTitle>
        <CardDescription>
          {editing
            ? 'Changes apply straight away. Membership and payment history stay as they are.'
            : 'Name, phone, and branch are enough to get started. Everything else can wait.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-6">
          <AuthFormMessage error={state.error} notice={state.success} />
          {member ? <input type="hidden" name="memberId" value={member.id} /> : null}
          <input type="hidden" name="homeBranchId" value={branchId} />
          <input type="hidden" name="gender" value={gender === NO_GENDER ? '' : gender} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName">Full name</Label>
              <Input
                id="fullName"
                name="fullName"
                required
                autoFocus
                autoComplete="off"
                defaultValue={member?.full_name ?? ''}
              />
              <FieldError messages={state.fieldErrors?.fullName} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                name="phone"
                inputMode="tel"
                required
                autoComplete="off"
                defaultValue={member?.phone ?? ''}
              />
              <FieldError messages={state.fieldErrors?.phone} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="homeBranchId">Home branch</Label>
              <Select value={branchId} onValueChange={(value) => setBranchId(String(value))}>
                <SelectTrigger id="homeBranchId" className="w-full">
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

            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email (optional)</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="off"
                defaultValue={member?.email ?? ''}
              />
              <FieldError messages={state.fieldErrors?.email} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="dateOfBirth">Date of birth (optional)</Label>
              <Input
                id="dateOfBirth"
                name="dateOfBirth"
                type="date"
                defaultValue={member?.date_of_birth ?? ''}
              />
              <FieldError messages={state.fieldErrors?.dateOfBirth} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="gender">Gender (optional)</Label>
              <Select value={gender} onValueChange={(value) => setGender(String(value))}>
                <SelectTrigger id="gender" className="w-full">
                  <SelectValue>
                    {gender === NO_GENDER
                      ? 'Not specified'
                      : GENDER_LABELS[gender as MemberGender]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_GENDER}>Not specified</SelectItem>
                  {(Object.keys(GENDER_LABELS) as MemberGender[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {GENDER_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError messages={state.fieldErrors?.gender} />
            </div>

            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="address">Address (optional)</Label>
              <Input
                id="address"
                name="address"
                autoComplete="off"
                defaultValue={member?.address ?? ''}
              />
              <FieldError messages={state.fieldErrors?.address} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="emergencyContactName">Emergency contact (optional)</Label>
              <Input
                id="emergencyContactName"
                name="emergencyContactName"
                placeholder="Name"
                autoComplete="off"
                defaultValue={member?.emergency_contact_name ?? ''}
              />
              <FieldError messages={state.fieldErrors?.emergencyContactName} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="emergencyContactPhone">Emergency contact phone</Label>
              <Input
                id="emergencyContactPhone"
                name="emergencyContactPhone"
                inputMode="tel"
                autoComplete="off"
                defaultValue={member?.emergency_contact_phone ?? ''}
              />
              <FieldError messages={state.fieldErrors?.emergencyContactPhone} />
            </div>

            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea id="notes" name="notes" defaultValue={member?.notes ?? ''} />
              <FieldError messages={state.fieldErrors?.notes} />
            </div>

            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="photo" className="text-muted-foreground">
                Photo (coming soon)
              </Label>
              <Input id="photo" type="file" disabled />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending
                ? editing
                  ? 'Saving...'
                  : 'Registering...'
                : editing
                  ? 'Save changes'
                  : 'Register member'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              render={<Link href={member ? `/members/${member.id}` : '/members'} />}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
