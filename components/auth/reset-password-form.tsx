'use client'

import { useActionState } from 'react'

import { updatePassword, type AuthFormState } from '@/app/(auth)/actions'
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

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    updatePassword,
    {}
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
        <CardDescription>You will be signed in once it is saved.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <AuthFormMessage error={state.error} notice={state.notice} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <FieldError messages={state.fieldErrors?.password} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <FieldError messages={state.fieldErrors?.confirm} />
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? 'Saving...' : 'Save password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
