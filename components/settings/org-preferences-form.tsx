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
    // Off unless the owner turned it on.
    trackCheckOut: bag.track_check_out === true,
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
            How class cancellations are handled, which language automatic messages use, and
            whether check-out is recorded.
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

          <div className="flex flex-col gap-2 sm:col-span-2">
            <div className="flex items-start gap-3">
              <input
                id="trackCheckOut"
                name="trackCheckOut"
                type="checkbox"
                defaultChecked={current.trackCheckOut}
                className="mt-1 size-4 rounded border-input accent-primary"
              />
              <div className="flex flex-col gap-1">
                <Label htmlFor="trackCheckOut">Record when members leave (check-out)</Label>
                <p className="text-xs text-muted-foreground">
                  Turn this on only if your gym has a way to check people out, such as an exit
                  reader. While it is off, the Check out button, the &ldquo;In the gym now&rdquo;
                  list, and the Out and Duration columns are hidden, because without check-outs
                  everyone who came in would look like they never left. Visits are still recorded
                  either way.
                </p>
              </div>
            </div>
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
