'use client'

import { useActionState, useEffect, useState } from 'react'

import {
  recordPayment,
  type MembershipActionState,
} from '@/app/(app)/members/[id]/membership-actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { PaymentMethodFields } from '@/components/memberships/payment-method-fields'
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
import { Textarea } from '@/components/ui/textarea'
import { formatDate, formatMoney } from '@/lib/format'
import type { PaymentMethod } from '@/lib/members'

export type OpenInvoice = {
  id: string
  invoice_no: string
  issued_on: string
  due_paisa: number
}

export function RecordPaymentForm({
  memberId,
  invoices,
  onSuccess,
}: {
  memberId: string
  invoices: OpenInvoice[]
  onSuccess: (message: string) => void
}) {
  const [state, formAction, pending] = useActionState<MembershipActionState, FormData>(
    recordPayment,
    {}
  )
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id ?? '')
  const [amount, setAmount] = useState(String((invoices[0]?.due_paisa ?? 0) / 100))
  const [method, setMethod] = useState<PaymentMethod>('cash')

  useEffect(() => {
    if (state.success) onSuccess(state.success)
  }, [state.success, onSuccess])

  const invoice = invoices.find((item) => item.id === invoiceId)

  function chooseInvoice(nextId: string) {
    setInvoiceId(nextId)
    const next = invoices.find((item) => item.id === nextId)
    if (next) setAmount(String(next.due_paisa / 100))
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="memberId" value={memberId} />
      <AuthFormMessage error={state.error} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="pay-invoice">Invoice</Label>
        <Select name="invoiceId" value={invoiceId} onValueChange={(value) => chooseInvoice(String(value))}>
          <SelectTrigger id="pay-invoice" className="w-full">
            <SelectValue>
              {invoice
                ? `${invoice.invoice_no} · ${formatMoney(invoice.due_paisa)} due`
                : 'Pick an invoice'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {invoices.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.invoice_no} · {formatDate(item.issued_on)} · {formatMoney(item.due_paisa)} due
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError messages={state.fieldErrors?.invoiceId} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="pay-amount">Amount (NPR)</Label>
          <Input
            id="pay-amount"
            name="amountPaisa"
            type="number"
            inputMode="decimal"
            min={1}
            step="1"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <FieldError messages={state.fieldErrors?.amountPaisa} />
        </div>

        <PaymentMethodFields
          idPrefix="pay"
          method={method}
          onMethodChange={setMethod}
          fieldErrors={state.fieldErrors}
        />

        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="pay-notes">Notes (optional)</Label>
          <Textarea id="pay-notes" name="notes" rows={2} maxLength={2000} />
          <FieldError messages={state.fieldErrors?.notes} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !invoice}>
          {pending ? 'Saving...' : 'Record payment'}
        </Button>
      </div>
    </form>
  )
}
