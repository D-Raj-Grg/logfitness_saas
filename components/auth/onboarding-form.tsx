'use client'

import { useActionState } from 'react'

import { createOrganization, type OnboardingFormState } from '@/app/onboarding/actions'
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

export function OnboardingForm({ defaultName }: { defaultName?: string }) {
  const [state, formAction, pending] = useActionState<OnboardingFormState, FormData>(
    createOrganization,
    {}
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up your gym</CardTitle>
        <CardDescription>
          You can add the rest of your branches and staff once you are inside.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <AuthFormMessage error={state.error} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="orgName">Gym or chain name</Label>
            <Input id="orgName" name="orgName" required autoFocus />
            <FieldError messages={state.fieldErrors?.orgName} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="branchName">First branch</Label>
            <Input
              id="branchName"
              name="branchName"
              placeholder="Main branch"
              required
            />
            <FieldError messages={state.fieldErrors?.branchName} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ownerName">Your name</Label>
            <Input
              id="ownerName"
              name="ownerName"
              defaultValue={defaultName}
              required
            />
            <FieldError messages={state.fieldErrors?.ownerName} />
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? 'Creating...' : 'Create gym'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
