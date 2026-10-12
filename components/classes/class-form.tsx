'use client'

import { useActionState, useEffect, useState } from 'react'

import {
  createClass,
  updateClass,
  type ClassFormState,
} from '@/app/(app)/classes/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { recurrenceOf, type ClassRow } from '@/lib/validation/classes'
import type { RecurrenceSlot } from '@/lib/validation/classes'

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export type ClassFormContext = {
  branches: { id: string; name: string }[]
  trainers: { id: string; full_name: string; branch_ids: string[] }[]
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/30'

export function ClassForm({
  cls,
  branches,
  trainers,
  onSaved,
}: ClassFormContext & { cls?: ClassRow; onSaved?: () => void }) {
  const [state, formAction, pending] = useActionState<ClassFormState, FormData>(
    cls ? updateClass : createClass,
    {}
  )
  const [slots, setSlots] = useState<RecurrenceSlot[]>(cls ? recurrenceOf(cls) : [])
  const [branchId, setBranchId] = useState(cls?.branch_id ?? branches[0]?.id ?? '')
  const [isActive, setIsActive] = useState(cls?.is_active ?? true)

  useEffect(() => {
    if (state.success) onSaved?.()
  }, [state, onSaved])

  function patch(index: number, change: Partial<RecurrenceSlot>) {
    setSlots((current) => current.map((s, i) => (i === index ? { ...s, ...change } : s)))
  }

  // A trainer must work at the class's branch; fall back to all if unknown.
  const branchTrainers = trainers.filter(
    (t) => t.branch_ids.length === 0 || t.branch_ids.includes(branchId)
  )

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <AuthFormMessage error={state.error} notice={state.success} />
      {cls ? <input type="hidden" name="classId" value={cls.id} /> : null}
      <input type="hidden" name="recurrence" value={JSON.stringify(slots)} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={cls?.name} required maxLength={120} />
        <FieldError messages={state.fieldErrors?.name} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea id="description" name="description" defaultValue={cls?.description ?? ''} maxLength={500} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="branchId">Branch</Label>
          {cls ? <input type="hidden" name="branchId" value={cls.branch_id} /> : null}
          <select
            id="branchId"
            name={cls ? undefined : 'branchId'}
            className={selectClass}
            value={branchId}
            disabled={Boolean(cls)}
            onChange={(e) => setBranchId(e.target.value)}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <FieldError messages={state.fieldErrors?.branchId} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="trainerId">Trainer</Label>
          <select
            id="trainerId"
            name="trainerId"
            className={selectClass}
            defaultValue={cls?.trainer_id ?? ''}
          >
            <option value="">No trainer</option>
            {branchTrainers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.full_name}
              </option>
            ))}
          </select>
          <FieldError messages={state.fieldErrors?.trainerId} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="capacity">Capacity</Label>
          <Input
            id="capacity"
            name="capacity"
            type="number"
            inputMode="numeric"
            min={1}
            defaultValue={cls?.capacity ?? 20}
            required
          />
          <FieldError messages={state.fieldErrors?.capacity} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="room">Room (optional)</Label>
          <Input id="room" name="room" defaultValue={cls?.room ?? ''} maxLength={80} />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Weekly schedule</legend>
        <p className="text-sm text-muted-foreground">
          Sessions are generated from these slots. Times are the gym&apos;s local time.
        </p>
        {slots.map((slot, index) => (
          <div key={index} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2">
            <select
              aria-label="Day"
              className={selectClass}
              value={slot.day_of_week}
              onChange={(e) => patch(index, { day_of_week: Number(e.target.value) })}
            >
              {DAYS.map((day, i) => (
                <option key={day} value={i}>
                  {day}
                </option>
              ))}
            </select>
            <Input
              aria-label="Start time"
              type="time"
              value={slot.start_time}
              onChange={(e) => patch(index, { start_time: e.target.value })}
              className="w-28"
            />
            <Input
              aria-label="End time"
              type="time"
              value={slot.end_time}
              onChange={(e) => patch(index, { end_time: e.target.value })}
              className="w-28"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSlots((c) => c.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setSlots((c) => [...c, { day_of_week: 1, start_time: '18:00', end_time: '19:00' }])
            }
          >
            Add slot
          </Button>
        </div>
        <FieldError messages={state.fieldErrors?.recurrence} />
      </fieldset>

      {cls ? (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={isActive} onCheckedChange={(c) => setIsActive(Boolean(c))} />
          Active
          <input type="hidden" name="isActive" value={isActive ? 'true' : 'false'} />
        </label>
      ) : null}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : cls ? 'Save class' : 'Add class'}
        </Button>
      </div>
    </form>
  )
}
