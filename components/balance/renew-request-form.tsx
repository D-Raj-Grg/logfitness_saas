'use client'

import { useActionState } from 'react'

import { requestRenewal, type RenewalFormState } from '@/app/(public)/balance/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * "Ask the desk to renew me." Phone and note are optional; the `website`
 * field is a honeypot that real visitors never see.
 */
export function RenewRequestForm({ org, token }: { org: string; token: string }) {
  const [state, formAction, pending] = useActionState<RenewalFormState, FormData>(
    requestRenewal,
    {}
  )

  if (state.success) {
    return <AuthFormMessage notice={state.success} />
  }

  return (
    <form action={formAction} className="flex flex-col gap-3 border-t pt-4">
      <input type="hidden" name="org" value={org} />
      <input type="hidden" name="c" value={token} />
      {/* Honeypot: hidden from people, filled by bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <AuthFormMessage error={state.error} />

      <p className="text-sm font-medium">Want to renew?</p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="phone">Phone (optional)</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={20}
          placeholder="98XXXXXXXX"
        />
        <FieldError messages={state.fieldErrors?.phone} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="note">Note (optional)</Label>
        <Textarea id="note" name="note" maxLength={500} placeholder="Same plan, from Monday" />
        <FieldError messages={state.fieldErrors?.note} />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Sending...' : 'Ask the front desk to renew'}
      </Button>
    </form>
  )
}
