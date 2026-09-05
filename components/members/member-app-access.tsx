'use client'

import { useActionState, useState } from 'react'

import { inviteMemberToApp, type MemberFormState } from '@/app/(app)/members/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDate } from '@/lib/format'

/**
 * The member-side mirror of staff's invited_at / accepted_at pair. A member
 * without auth_user_id has never linked an account regardless of what
 * accepted_at says -- that column is only ever set by link_member_account()
 * at the same time it sets auth_user_id, so checking either is equivalent,
 * but auth_user_id is the one RLS actually keys off of.
 */
export function MemberAppAccess({
  memberId,
  email,
  invitedAt,
  acceptedAt,
  hasAuthUser,
}: {
  memberId: string
  email: string | null
  invitedAt: string | null
  acceptedAt: string | null
  hasAuthUser: boolean
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<MemberFormState, FormData>(
    async (prev, formData) => {
      const result = await inviteMemberToApp(prev, formData)
      // The page revalidates behind the dialog, so on success it can simply
      // close; an error or field error stays visible inside it.
      if (result.success) setOpen(false)
      return result
    },
    {}
  )

  const invited = Boolean(invitedAt)
  const active = hasAuthUser && Boolean(acceptedAt)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Mobile app</span>
        <span className="text-sm text-muted-foreground">
          {active && acceptedAt
            ? `Active since ${formatDate(acceptedAt)}`
            : invited && invitedAt
              ? `Invited on ${formatDate(invitedAt)}`
              : 'Not invited yet'}
        </span>
      </div>

      {active ? null : (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
            {invited ? 'Resend invite' : 'Invite to the app'}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <form action={formAction} className="flex flex-col gap-4">
              <input type="hidden" name="memberId" value={memberId} />
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {invited ? 'Resend the app invitation?' : 'Invite this member to the app'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  They can sign up with this email address in the mobile app and see their
                  own membership, dues, and check-ins.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <AuthFormMessage error={state.error} />

              <div className="flex flex-col gap-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  required
                  defaultValue={email ?? ''}
                />
                <FieldError messages={state.fieldErrors?.email} />
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                <AlertDialogAction type="submit" disabled={pending}>
                  {pending ? 'Sending...' : invited ? 'Resend invite' : 'Send invite'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}
