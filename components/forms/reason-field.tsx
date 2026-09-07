'use client'

import { useState } from 'react'

import { FieldError } from '@/components/auth/auth-form-message'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * A reason box with the four or five answers that are actually given, as chips
 * above it.
 *
 * The chips are a shortcut, not a menu: the textarea is always there, always
 * editable, and a chip only drops its words into it. That matters because these
 * reasons are read back months later by whoever is reconciling the drawer or
 * arguing with a member -- "Other" would tell them nothing, and a select would
 * push everyone towards the nearest wrong option.
 *
 * Tapping the chip that matches what is written clears it, so a mis-tap costs
 * one tap rather than a text selection on a phone at the counter.
 */
export function ReasonField({
  id,
  name = 'reason',
  label = 'Reason',
  presets,
  placeholder,
  required,
  rows = 2,
  maxLength = 500,
  messages,
}: {
  id: string
  name?: string
  label?: string
  /** The handful of answers worth one tap. Everything else is typed. */
  presets: string[]
  placeholder?: string
  required?: boolean
  rows?: number
  maxLength?: number
  messages?: string[]
}) {
  const [value, setValue] = useState('')
  const current = value.trim()

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>
        {label}
        {required ? null : (
          <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
        )}
      </Label>

      <div className="flex flex-wrap gap-1.5">
        {presets.map((preset) => {
          const active = current === preset
          return (
            <Button
              key={preset}
              type="button"
              size="sm"
              variant={active ? 'secondary' : 'outline'}
              className="h-7 rounded-full px-3 text-xs font-normal"
              aria-pressed={active}
              onClick={() => setValue(active ? '' : preset)}
            >
              {preset}
            </Button>
          )
        })}
      </div>

      <Textarea
        id={id}
        name={name}
        rows={rows}
        required={required}
        minLength={required ? 3 : undefined}
        maxLength={maxLength}
        placeholder={placeholder ?? 'Pick one above, or write your own'}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />

      <FieldError messages={messages} />
    </div>
  )
}
