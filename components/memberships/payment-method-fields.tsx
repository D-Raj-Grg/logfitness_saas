'use client'

import { FieldError } from '@/components/auth/auth-form-message'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  PAYMENT_METHOD_LABELS,
  methodNeedsReference,
  type PaymentMethod,
} from '@/lib/members'

export const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]

/**
 * Method select plus the transaction reference every digital rail needs. The
 * reference field only appears once it is required, so a cash sale is two
 * clicks and an eSewa sale cannot be saved without the thing that reconciles it.
 */
export function PaymentMethodFields({
  method,
  onMethodChange,
  idPrefix,
  referenceRequired = true,
  fieldErrors,
}: {
  method: PaymentMethod
  onMethodChange: (method: PaymentMethod) => void
  idPrefix: string
  referenceRequired?: boolean
  fieldErrors?: Record<string, string[]>
}) {
  const needsReference = methodNeedsReference(method)

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-method`}>Method</Label>
        <Select
          name="method"
          value={method}
          onValueChange={(value) => onMethodChange(value as PaymentMethod)}
        >
          <SelectTrigger id={`${idPrefix}-method`} className="w-full">
            <SelectValue>{PAYMENT_METHOD_LABELS[method]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_METHODS.map((value) => (
              <SelectItem key={value} value={value}>
                {PAYMENT_METHOD_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError messages={fieldErrors?.method} />
      </div>

      {needsReference ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-reference`}>Reference no.</Label>
          <Input
            id={`${idPrefix}-reference`}
            name="referenceNo"
            required={referenceRequired}
            placeholder="Transaction ID from the app or slip"
            maxLength={120}
          />
          <FieldError messages={fieldErrors?.referenceNo} />
        </div>
      ) : null}
    </>
  )
}
