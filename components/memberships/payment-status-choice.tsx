'use client'

import { cn } from 'cn'

/**
 * What the member actually handed over. The QR fails, the card machine is down,
 * or they say they will pay on Sunday -- and the desk still has to register
 * them. Before this, the amount box was prefilled with the full price and the
 * quickest path through the form recorded a payment that never happened.
 *
 * Not a form field: the choice drives which inputs are mounted, and the amount
 * itself is what gets submitted. An unpaid sale still raises the invoice, so
 * the dues show up on the profile and in the arrears report.
 */
export type PaymentStatus = 'full' | 'part' | 'unpaid'

const OPTIONS: { value: PaymentStatus; label: string; hint: string }[] = [
  { value: 'full', label: 'Paid in full', hint: 'Nothing outstanding' },
  { value: 'part', label: 'Part paid', hint: 'Type what came in' },
  { value: 'unpaid', label: 'Unpaid', hint: 'Bill it, collect later' },
]

export function PaymentStatusChoice({
  value,
  onChange,
  idPrefix,
  disabled,
}: {
  value: PaymentStatus
  onChange: (value: PaymentStatus) => void
  /** Two of these can share a page, so the radio group needs its own name. */
  idPrefix: string
  disabled?: boolean
}) {
  return (
    <div role="radiogroup" aria-label="Payment" className="grid gap-2 sm:grid-cols-3">
      {OPTIONS.map((option) => (
        <label
          key={option.value}
          className={cn(
            'flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-sm transition-colors',
            value === option.value
              ? 'border-primary bg-primary/5'
              : 'hover:bg-muted/50',
            disabled && 'pointer-events-none opacity-50'
          )}
        >
          <span className="flex items-center gap-2 font-medium">
            <input
              type="radio"
              className="accent-primary"
              name={`${idPrefix}-payment-status`}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </span>
          <span className="pl-6 text-xs text-muted-foreground">{option.hint}</span>
        </label>
      ))}
    </div>
  )
}
