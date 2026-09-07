'use client'

import { useActionState, useEffect, useState } from 'react'

import {
  adjustMembershipDates,
  cancelMembership,
  freezeMembership,
  unfreezeMembership,
  type MembershipActionState,
} from '@/app/(app)/members/[id]/membership-actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { ReasonField } from '@/components/forms/reason-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addDays, daysBetween, formatDate } from '@/lib/format'

type Props = {
  memberId: string
  membershipId: string
  onSuccess: (message: string, document?: { href: string; label: string }) => void
}

function useCloseOnSuccess(state: MembershipActionState, onSuccess: Props['onSuccess']) {
  useEffect(() => {
    if (state.success) onSuccess(state.success, state.document)
  }, [state.success, state.document, onSuccess])
}

export function FreezeForm({ memberId, membershipId, onSuccess }: Props) {
  const [state, formAction, pending] = useActionState<MembershipActionState, FormData>(
    freezeMembership,
    {}
  )
  useCloseOnSuccess(state, onSuccess)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <AuthFormMessage error={state.error} />

      <ReasonField
        id="freeze-notes"
        name="notes"
        label="Notes"
        maxLength={2000}
        presets={['Travelling', 'Injury', 'Medical leave', 'Exams']}
        messages={state.fieldErrors?.notes}
      />

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : 'Freeze membership'}
        </Button>
      </div>
    </form>
  )
}

/** Rendered inside an AlertDialog: the only input is the confirmation. */
export function UnfreezeForm({
  memberId,
  membershipId,
  onSuccess,
  cancelButton,
}: Props & { cancelButton: React.ReactNode }) {
  const [state, formAction, pending] = useActionState<MembershipActionState, FormData>(
    unfreezeMembership,
    {}
  )
  useCloseOnSuccess(state, onSuccess)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <AuthFormMessage error={state.error} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {cancelButton}
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : 'Unfreeze'}
        </Button>
      </div>
    </form>
  )
}

export function CancelForm({ memberId, membershipId, onSuccess }: Props) {
  const [state, formAction, pending] = useActionState<MembershipActionState, FormData>(
    cancelMembership,
    {}
  )
  useCloseOnSuccess(state, onSuccess)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <AuthFormMessage error={state.error} />

      <ReasonField
        id="cancel-reason"
        required
        placeholder="Why the membership is being cancelled"
        presets={[
          'Member left the gym',
          'Moved away',
          'Injury or illness',
          'Sold the wrong plan',
        ]}
        messages={state.fieldErrors?.reason}
      />

      <div className="flex justify-end">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? 'Saving...' : 'Cancel membership'}
        </Button>
      </div>
    </form>
  )
}

/**
 * Move -- or correct -- the window of a membership already sold. Owners and
 * managers only; the action and the RPC both check, and the panel does not
 * render the button for anyone else.
 *
 * Moving the start drags the end along by the same number of days, because the
 * member paid for a term, not for a pair of dates: "start me Tuesday instead"
 * must not cost them the two days. Editing the end on its own is still how
 * complimentary days are given.
 *
 * The quick buttons are the reason this is a form rather than two bare date
 * inputs: "give her a week" is the request, and counting days forward from an
 * end date is exactly the arithmetic the desk gets wrong.
 */
export function AdjustDatesForm({
  memberId,
  membershipId,
  currentStartDate,
  currentEndDate,
  canMoveStart,
  onSuccess,
}: Props & {
  currentStartDate: string
  currentEndDate: string | null
  /** False once someone has checked in against this membership. */
  canMoveStart: boolean
}) {
  const [startDate, setStartDate] = useState(currentStartDate)
  const [endDate, setEndDate] = useState(currentEndDate ?? '')
  const [state, formAction, pending] = useActionState<MembershipActionState, FormData>(
    adjustMembershipDates,
    {}
  )
  useCloseOnSuccess(state, onSuccess)

  /** The end follows the start, so the term the member paid for is preserved. */
  function changeStart(next: string) {
    if (!next) return
    const shift = daysBetween(startDate, next)
    setStartDate(next)
    if (endDate) setEndDate(addDays(endDate, shift))
  }

  const shiftEnd = (days: number) =>
    setEndDate((current) => addDays(current || currentEndDate || startDate, days))

  function reset() {
    setStartDate(currentStartDate)
    setEndDate(currentEndDate ?? '')
  }

  const moved = daysBetween(currentStartDate, startDate)
  const termChange =
    currentEndDate && endDate ? daysBetween(currentEndDate, endDate) - moved : 0

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <AuthFormMessage error={state.error} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="adjust-start-date">Start date</Label>
          <Input
            id="adjust-start-date"
            name="startDate"
            type="date"
            required
            disabled={!canMoveStart}
            value={startDate}
            onChange={(event) => changeStart(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {canMoveStart
              ? 'The end date moves with it, so the term stays the same length.'
              : 'They have already checked in on this membership, so the start date is fixed.'}
          </p>
          <FieldError messages={state.fieldErrors?.startDate} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="adjust-end-date">End date</Label>
          <Input
            id="adjust-end-date"
            name="endDate"
            type="date"
            required={Boolean(currentEndDate)}
            disabled={!currentEndDate}
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {currentEndDate
              ? `Currently ends ${formatDate(currentEndDate)}.`
              : 'This pack runs until the sessions are used up.'}
          </p>
          <FieldError messages={state.fieldErrors?.endDate} />
        </div>
      </div>

      {currentEndDate ? (
        <div className="flex flex-wrap items-center gap-2">
          {[7, 15, 30].map((days) => (
            <Button
              key={days}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => shiftEnd(days)}
            >
              +{days} days
            </Button>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={reset}>
            Reset
          </Button>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {moved !== 0
          ? `Pushed ${moved > 0 ? 'back' : 'forward'} ${Math.abs(moved)} day${Math.abs(moved) === 1 ? '' : 's'}. `
          : ''}
        {termChange !== 0
          ? `${termChange > 0 ? 'Gains' : 'Loses'} ${Math.abs(termChange)} day${Math.abs(termChange) === 1 ? '' : 's'}. `
          : ''}
        The plan, the price and the invoice do not move.
      </p>

      <ReasonField
        id="adjust-reason"
        required
        presets={[
          'Member asked to start later',
          'Complimentary days',
          'Wrong plan entered',
          'Gym was closed',
        ]}
        messages={state.fieldErrors?.reason}
      />

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : 'Save dates'}
        </Button>
      </div>
    </form>
  )
}
