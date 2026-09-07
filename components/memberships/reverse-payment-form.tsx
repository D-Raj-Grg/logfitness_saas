'use client'

import { useActionState, useEffect } from 'react'

import {
  reversePayment,
  type MembershipActionState,
} from '@/app/(app)/members/[id]/membership-actions'
import { AuthFormMessage } from '@/components/auth/auth-form-message'
import { ReasonField } from '@/components/forms/reason-field'
import type { RefundablePayment } from '@/components/memberships/refund-form'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatMoney } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '@/lib/members'

/**
 * "I'll pay tomorrow" -- said after the sale was already rung up as paid.
 *
 * Not a refund: no money left the drawer, and booking one would put the same
 * note through the day's sheet twice. A reversal is its own kind, so the
 * collection sheet nets it out and gross takings stop counting cash that never
 * arrived. The whole entry goes back; a part payment that was only partly
 * received is a reversal plus a fresh payment for what did come in.
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

  useEffect(() => {
    if (state.success) onSuccess(state.success, state.document)
  }, [state.success, state.document, onSuccess])

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="paymentId" value={payment.id} />
      <AuthFormMessage error={state.error} />

      <p className="text-sm text-muted-foreground">
        Taking back the {PAYMENT_METHOD_LABELS[payment.method]} entry of{' '}
        <span className="font-medium text-foreground">{formatMoney(payment.amount_paisa)}</span>{' '}
        recorded {formatDateTime(payment.paid_at)}. The invoice owes it again, and
        the reversal shows on the drawer sheet beside the original.
      </p>

      <ReasonField
        id="reverse-reason"
        required
        presets={[
          'Said they would pay tomorrow',
          'Online payment never went through',
          'Recorded on the wrong member',
          'Cash was never handed over',
        ]}
        messages={state.fieldErrors?.reason}
      />

      <div className="flex justify-end">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? 'Saving...' : 'Mark as never paid'}
        </Button>
      </div>
    </form>
  )
}
