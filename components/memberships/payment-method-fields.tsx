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
  names,
}: {
  method: PaymentMethod
  onMethodChange: (method: PaymentMethod) => void
  idPrefix: string
  referenceRequired?: boolean
  fieldErrors?: Record<string, string[]>
  /**
   * FormData names for the two inputs, for a form that already uses `method`
   * or `referenceNo` for something else. Defaulted, so the forms that had this
   * component to themselves are unchanged.
   *
   * The fieldErrors keys deliberately do not follow: those come from the zod
   * schema, whose paths stay unprefixed.
   */
  names?: { method: string; reference: string }
}) {
  const methodName = names?.method ?? 'method'
  const referenceName = names?.reference ?? 'referenceNo'
  const needsReference = methodNeedsReference(method)

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-method`}>Method</Label>
        <Select
          name={methodName}
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
            name={referenceName}
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
