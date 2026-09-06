'use client'

import { useActionState, useEffect, useState } from 'react'

import {
  refundPayment,
  type MembershipActionState,
} from '@/app/(app)/members/[id]/membership-actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { PaymentMethodFields } from '@/components/memberships/payment-method-fields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatDateTime, formatMoney } from '@/lib/format'
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@/lib/members'

export type RefundablePayment = {
  id: string
  amount_paisa: number
  method: PaymentMethod
  paid_at: string
}

export function RefundForm({
  memberId,
  payment,
  onSuccess,
}: {
  memberId: string
  payment: RefundablePayment
  onSuccess: (message: string, document?: { href: string; label: string }) => void
}) {
  const [state, formAction, pending] = useActionState<MembershipActionState, FormData>(
    refundPayment,
    {}
  )
  const [method, setMethod] = useState<PaymentMethod>(payment.method)

  useEffect(() => {
    if (state.success) onSuccess(state.success, state.document)
  }, [state.success, state.document, onSuccess])

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="paymentId" value={payment.id} />
      <AuthFormMessage error={state.error} />

      <p className="text-sm text-muted-foreground">
        Refunding the {PAYMENT_METHOD_LABELS[payment.method]} payment of{' '}
        <span className="font-medium text-foreground">{formatMoney(payment.amount_paisa)}</span>{' '}
        taken {formatDateTime(payment.paid_at)}. The refund is recorded as a separate
        line; the original stays on the books.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="refund-amount">Amount (NPR)</Label>
          <Input
            id="refund-amount"
            name="amountPaisa"
            type="number"
            inputMode="decimal"
            min={1}
            step="1"
            required
            defaultValue={String(payment.amount_paisa / 100)}
          />
          <FieldError messages={state.fieldErrors?.amountPaisa} />
        </div>

        <PaymentMethodFields
          idPrefix="refund"
          method={method}
          onMethodChange={setMethod}
          referenceRequired={false}
          fieldErrors={state.fieldErrors}
        />

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="refund-reason">Reason</Label>
          <Textarea
            id="refund-reason"
            name="reason"
            rows={2}
            required
            minLength={3}
            maxLength={500}
            placeholder="Why the money is going back"
          />
          <FieldError messages={state.fieldErrors?.reason} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? 'Saving...' : 'Record refund'}
        </Button>
      </div>
    </form>
  )
}
