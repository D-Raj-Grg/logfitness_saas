'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { signUp, type AuthFormState } from '@/app/(auth)/actions'
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

export function SignupForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    signUp,
    {}
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          Starting a new gym, or joining one you were invited to.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <AuthFormMessage error={state.error} notice={state.notice} />

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

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
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

          <Button type="submit" disabled={pending}>
            {pending ? 'Creating account...' : 'Create account'}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
