'use client'

import { Trash2 } from 'lucide-react'
import { useActionState, useEffect, useRef } from 'react'

import {
  addHoliday,
  removeHoliday,
  saveWeeklyOff,
  type ScheduleFormState,
} from '@/app/(app)/settings/schedule/actions'
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
import { formatDate } from '@/lib/format'
import { WEEKDAYS, type OrgHoliday } from '@/lib/schedule'

const HELPER = "Members' attendance calendar shows these days as off instead of absent."

export function WeeklyOffForm({ weeklyOff }: { weeklyOff: number[] }) {
  const [state, formAction, pending] = useActionState<ScheduleFormState, FormData>(
    saveWeeklyOff,
    {}
  )

  return (
    <form action={formAction}>
      <Card>
        <CardHeader>
          <CardTitle>Weekly days off</CardTitle>
          <CardDescription>
            The days the gym is closed every week. {HELPER}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <AuthFormMessage error={state.error} notice={state.success} />
          <fieldset className="flex flex-wrap gap-x-6 gap-y-3">
            <legend className="sr-only">Days the gym is closed</legend>
            {WEEKDAYS.map((day) => (
              <label key={day.iso} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="weeklyOff"
                  value={day.iso}
                  defaultChecked={weeklyOff.includes(day.iso)}
                  className="size-4 rounded border-input accent-primary"
                />
                {day.label}
              </label>
            ))}
          </fieldset>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving...' : 'Save weekly days off'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}

function HolidayRow({ holiday }: { holiday: OrgHoliday }) {
  const [state, formAction, pending] = useActionState<ScheduleFormState, FormData>(
    removeHoliday,
    {}
  )

  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{holiday.name}</div>
        <div className="text-xs text-muted-foreground">
          {formatDate(`${holiday.on_date}T12:00:00Z`, 'UTC')}
        </div>
        {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      </div>
      <form action={formAction}>
        <input type="hidden" name="id" value={holiday.id} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={pending}
          aria-label={`Remove ${holiday.name}`}
        >
          <Trash2 />
          Remove
        </Button>
      </form>
    </li>
  )
}

export function HolidaysSection({ holidays }: { holidays: OrgHoliday[] }) {
  const [state, formAction, pending] = useActionState<ScheduleFormState, FormData>(
    addHoliday,
    {}
  )
  const formRef = useRef<HTMLFormElement>(null)

  // Clear the fields after a successful add so the next holiday starts empty.
  useEffect(() => {
    if (state.success) formRef.current?.reset()
  }, [state])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Holidays</CardTitle>
        <CardDescription>
          One-off days the gym is closed, for every branch. {HELPER}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form ref={formRef} action={formAction} className="flex flex-col gap-3">
          <AuthFormMessage error={state.error} notice={state.success} />
          <div className="grid gap-3 sm:grid-cols-[11rem_1fr_auto] sm:items-start">
            <div className="flex flex-col gap-2">
              <Label htmlFor="holidayDate">Date</Label>
              <Input id="holidayDate" name="onDate" type="date" required />
              <FieldError messages={state.fieldErrors?.onDate} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="holidayName">Name</Label>
              <Input
                id="holidayName"
                name="name"
                maxLength={80}
                placeholder="e.g. Dashain"
                required
              />
              <FieldError messages={state.fieldErrors?.name} />
            </div>
            <div className="sm:pt-[1.625rem]">
              <Button type="submit" disabled={pending}>
                {pending ? 'Adding...' : 'Add holiday'}
              </Button>
            </div>
          </div>
        </form>

        {holidays.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No holidays yet.
          </div>
        ) : (
          <ul className="flex flex-col divide-y">
            {holidays.map((holiday) => (
              <HolidayRow key={holiday.id} holiday={holiday} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
