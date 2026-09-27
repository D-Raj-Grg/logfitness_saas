'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { requestPasswordReset, type AuthFormState } from '@/app/(auth)/actions'
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

export function ForgotPasswordForm({ expired }: { expired?: boolean }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    requestPasswordReset,
    expired ? { error: 'That reset link has expired. Request a new one.' } : {}
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Forgot your password?</CardTitle>
        <CardDescription>
          Enter your email and we will send you a link to set a new one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <AuthFormMessage error={state.error} notice={state.notice} />

          {state.notice ? null : (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                />
                <FieldError messages={state.fieldErrors?.email} />
              </div>

              <Button type="submit" disabled={pending}>
                {pending ? 'Sending...' : 'Send reset link'}
              </Button>
            </>
          )}

          <p className="text-center text-sm text-muted-foreground">
            <Link href="/login" className="underline underline-offset-4">
              Back to sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
