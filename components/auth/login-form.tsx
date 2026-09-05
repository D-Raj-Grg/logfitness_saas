'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { signIn, type AuthFormState } from '@/app/(auth)/actions'
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

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    signIn,
    {}
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Staff access to your gym&apos;s console.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          {next ? <input type="hidden" name="next" value={next} /> : null}

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
              autoComplete="current-password"
              required
            />
            <FieldError messages={state.fieldErrors?.password} />
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? 'Signing in...' : 'Sign in'}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            New gym?{' '}
            <Link href="/signup" className="underline underline-offset-4">
              Create an account
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
