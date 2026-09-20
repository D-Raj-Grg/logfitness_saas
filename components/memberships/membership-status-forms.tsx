'use client'

import { useActionState, useEffect, useState } from 'react'

import {
  adjustMembershipDates,
  adjustMembershipDiscount,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { addDays, daysBetween, formatDate, formatMoney } from '@/lib/format'
import { paisaOrZero, rupees } from '@/lib/plan-pricing'
import {
  DISCOUNT_REASONS,
  DISCOUNT_REASON_LABELS,
  type DiscountReason,
} from '@/lib/members'

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

/**
 * Re-pricing a membership already sold. The desk types the price that was
 * agreed, not the discount, because that is the number the conversation
 * produced -- "make it 6,000". The discount is what the form submits, so what
 * reaches the RPC is the same shape a sale uses.
 *
 * The two refusals the RPC will make are shown before the round trip: a price
 * can only come down, and never below what has already been collected.
 */
export function AdjustDiscountForm({
  memberId,
  membershipId,
  subtotalPaisa,
  currentDiscountPaisa,
  paidPaisa,
  onSuccess,
}: Props & {
  /** What was billed. This does not move -- the plan's price is a fact. */
  subtotalPaisa: number
  currentDiscountPaisa: number
  paidPaisa: number
}) {
  const currentTotal = subtotalPaisa - currentDiscountPaisa
  const [newPrice, setNewPrice] = useState(rupees(currentTotal))
  const [discountReason, setDiscountReason] = useState<DiscountReason | ''>('')
  const [discountNote, setDiscountNote] = useState('')
  const [state, formAction, pending] = useActionState<MembershipActionState, FormData>(
    adjustMembershipDiscount,
    {}
  )
  useCloseOnSuccess(state, onSuccess)

  const nextTotal = paisaOrZero(newPrice)
  const discountPaisa = subtotalPaisa - nextTotal
  const off = discountPaisa - currentDiscountPaisa

  const tooHigh = nextTotal >= currentTotal
  const belowCollected = nextTotal < paidPaisa

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <input type="hidden" name="discountPaisa" value={rupees(discountPaisa)} />
      <AuthFormMessage error={state.error} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="adjust-price">New price</Label>
        <Input
          id="adjust-price"
          type="number"
          inputMode="decimal"
          min={0}
          step="1"
          required
          value={newPrice}
          onChange={(event) => setNewPrice(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {`Billed at ${formatMoney(subtotalPaisa)}`}
          {currentDiscountPaisa > 0
            ? `, currently ${formatMoney(currentTotal)} after ${formatMoney(currentDiscountPaisa)} off.`
            : '.'}
          {off > 0 ? ` Taking ${formatMoney(off)} more off.` : ''}
        </p>
        {tooHigh ? (
          <p className="text-xs text-destructive">
            A price can only come down. Charging more is a new sale, not a correction.
          </p>
        ) : null}
        {belowCollected ? (
          <p className="text-xs text-destructive">
            {`${formatMoney(paidPaisa)} has already been collected. Refund the difference first.`}
          </p>
        ) : null}
        <FieldError messages={state.fieldErrors?.discountPaisa} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="adjust-discount-reason">Reason for the discount</Label>
        <Select
          name="discountReason"
          value={discountReason}
          onValueChange={(value) => setDiscountReason(value as DiscountReason)}
        >
          <SelectTrigger id="adjust-discount-reason" className="w-full">
            <SelectValue>
              {discountReason ? DISCOUNT_REASON_LABELS[discountReason] : 'Pick a reason'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {DISCOUNT_REASONS.map((reason) => (
              <SelectItem key={reason} value={reason}>
                {DISCOUNT_REASON_LABELS[reason]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          This prints on the invoice, beside the amount saved.
        </p>
        <FieldError messages={state.fieldErrors?.discountReason} />
      </div>

      {discountReason === 'other' ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="adjust-discount-note">Describe the reason</Label>
          <Input
            id="adjust-discount-note"
            name="discountNote"
            maxLength={120}
            placeholder="Prints on the invoice"
            value={discountNote}
            onChange={(event) => setDiscountNote(event.target.value)}
          />
          <FieldError messages={state.fieldErrors?.discountNote} />
        </div>
      ) : null}

      <ReasonField
        id="adjust-price-reason"
        required
        presets={[
          'Negotiated with the member',
          'Corrected an over-charge',
          'Matched a quoted price',
          'Manager approved',
        ]}
        messages={state.fieldErrors?.reason}
      />

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || tooHigh || belowCollected}>
          {pending ? 'Saving...' : `Set price to ${formatMoney(nextTotal)}`}
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
