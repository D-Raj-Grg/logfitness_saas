'use client'

import { useActionState, useEffect, useState } from 'react'

import {
  reversePayment,
  type MembershipActionState,
} from '@/app/(app)/members/[id]/membership-actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { ReasonField } from '@/components/forms/reason-field'
import type { RefundablePayment } from '@/components/memberships/refund-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from 'cn'
import { formatDateTime, formatMoney, toPaisa } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '@/lib/members'

/**
 * "I'll pay tomorrow" -- said after the sale was already rung up as paid.
 *
 * Not a refund: no money left the drawer, and booking one would put the same
 * note through the day's sheet twice. A reversal is its own kind, so the
 * collection sheet nets it out and gross takings stop counting cash that never
 * arrived.
 *
 * Part of an entry can come back the same way, for the sale rung up at the full
 * price when less was handed over. The desk types what the member actually gave;
 * the form takes back the rest, because "they paid 1,000" is the sentence said
 * at the counter and subtracting it in your head at the till is how the wrong
 * number gets typed.
 */
export function ReversePaymentForm({
  memberId,
  payment,
  onSuccess,
}: {
  memberId: string
  payment: RefundablePayment
  onSuccess: (message: string, document?: { href: string; label: string }) => void
}) {
  const [state, formAction, pending] = useActionState<MembershipActionState, FormData>(
    reversePayment,
    {}
  )
  const [scope, setScope] = useState<'all' | 'part'>('all')
  const [received, setReceived] = useState('')

  useEffect(() => {
    if (state.success) onSuccess(state.success, state.document)
  }, [state.success, state.document, onSuccess])

  let receivedPaisa: number | null = null
  try {
    receivedPaisa = received.trim() === '' ? null : toPaisa(received)
  } catch {
    receivedPaisa = null
  }

  const partIsUsable =
    receivedPaisa !== null && receivedPaisa > 0 && receivedPaisa < payment.amount_paisa

  const takenBack = partIsUsable
    ? payment.amount_paisa - (receivedPaisa as number)
    : payment.amount_paisa

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="paymentId" value={payment.id} />
      {/* Empty means the whole entry, which is what the server treats as the
          default. Only a usable part amount is sent. */}
      <input
        type="hidden"
        name="amountPaisa"
        value={scope === 'part' && partIsUsable ? String(takenBack / 100) : ''}
      />
      <AuthFormMessage error={state.error} />

      <p className="text-sm text-muted-foreground">
        The {PAYMENT_METHOD_LABELS[payment.method]} entry of{' '}
        <span className="font-medium text-foreground">{formatMoney(payment.amount_paisa)}</span>{' '}
        recorded {formatDateTime(payment.paid_at)}. What comes back off it goes on
        the drawer sheet beside the original, and the invoice owes it again.
      </p>

      <div role="radiogroup" aria-label="How much never arrived" className="grid gap-2">
        {(
          [
            { value: 'all', label: 'None of it came in', hint: 'Take the whole entry back' },
            {
              value: 'part',
              label: 'Only part came in',
              hint: 'Type what the member actually gave',
            },
          ] as const
        ).map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-sm transition-colors',
              scope === option.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <input
                type="radio"
                className="accent-primary"
                name="reverse-scope"
                value={option.value}
                checked={scope === option.value}
                onChange={() => setScope(option.value)}
              />
              {option.label}
            </span>
            <span className="pl-6 text-xs text-muted-foreground">{option.hint}</span>
          </label>
        ))}
      </div>

      {scope === 'part' ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="reverse-received">Amount actually received (NPR)</Label>
          <Input
            id="reverse-received"
            type="number"
            inputMode="decimal"
            min={1}
            max={payment.amount_paisa / 100 - 1}
            step="1"
            required
            value={received}
            onChange={(event) => setReceived(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {partIsUsable
              ? `Taking back ${formatMoney(takenBack)}. The invoice keeps ${formatMoney(receivedPaisa as number)} and goes to part paid.`
              : `Less than ${formatMoney(payment.amount_paisa)}. For the whole entry, pick "None of it came in".`}
          </p>
          <FieldError messages={state.fieldErrors?.amountPaisa} />
        </div>
      ) : null}

      <ReasonField
        id="reverse-reason"
        required
        presets={[
          'Said they would pay tomorrow',
          'Paid less than was rung up',
          'Online payment never went through',
          'Recorded on the wrong member',
        ]}
        messages={state.fieldErrors?.reason}
      />

      <div className="flex justify-end">
        <Button
          type="submit"
          variant="destructive"
          disabled={pending || (scope === 'part' && !partIsUsable)}
        >
          {pending
            ? 'Saving...'
            : scope === 'part'
              ? `Take back ${formatMoney(takenBack)}`
              : 'Mark as never paid'}
        </Button>
      </div>
    </form>
  )
}
