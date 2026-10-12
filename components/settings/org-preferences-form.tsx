'use client'

import { useActionState } from 'react'

import {
  updateOrgPreferences,
  type SettingsFormState,
} from '@/app/(app)/settings/actions'
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
import type { Json } from '@/lib/types/database'

const DEFAULT_CANCELLATION_WINDOW_MINUTES = 120

function readSettings(settings: Json) {
  const bag =
    settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}

  const window = bag.class_cancellation_window_minutes
  const locale = bag.notification_locale

  return {
    windowMinutes:
      typeof window === 'number' && Number.isInteger(window) && window >= 0
        ? window
        : DEFAULT_CANCELLATION_WINDOW_MINUTES,
    locale: locale === 'ne' ? 'ne' : 'en',
  }
}

export function OrgPreferencesForm({ settings }: { settings: Json }) {
  const [state, formAction, pending] = useActionState<SettingsFormState, FormData>(
    updateOrgPreferences,
    {}
  )
  const current = readSettings(settings)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <AuthFormMessage error={state.error} notice={state.success} />

      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
          <CardDescription>
            How class cancellations are handled and which language automatic messages
            use.
          </CardDescription>
        </CardHeader>

        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="classCancellationWindowMinutes">
              Class cancellation window (minutes)
            </Label>
            <Input
              id="classCancellationWindowMinutes"
              name="classCancellationWindowMinutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={10080}
              step={1}
              required
              defaultValue={current.windowMinutes}
            />
            <p className="text-xs text-muted-foreground">
              Members cannot cancel a booking this close to the class start. 0 to 10080.
            </p>
            <FieldError messages={state.fieldErrors?.classCancellationWindowMinutes} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="notificationLocale">Notification language</Label>
            <select
              id="notificationLocale"
              name="notificationLocale"
              defaultValue={current.locale}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="en">English</option>
              <option value="ne">Nepali</option>
            </select>
            <FieldError messages={state.fieldErrors?.notificationLocale} />
          </div>
        </CardContent>
      </Card>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : 'Save preferences'}
        </Button>
      </div>
    </form>
  )
}
