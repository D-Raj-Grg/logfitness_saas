'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { createCardStockRange, type CardFormState } from '@/app/(app)/cards/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CARD_NO_MAX, CARD_NO_MIN, cardLabel } from '@/lib/cards/card-no'
import { MAX_RANGE_SIZE } from '@/lib/validation/cards'
import { useDismissibleActionState } from '@/hooks/use-dismissible-action-state'

const DEFAULT_RUN = 100

/**
 * Number the next run of printed cards. From defaults to the first free
 * number so consecutive orders never overlap; To follows it by a hundred, the
 * usual print-shop batch. The RPC refuses a number that already exists.
 */
export function CreateRangeDialog({ nextFreeNo }: { nextFreeNo: number }) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(String(nextFreeNo))
  const [to, setTo] = useState(String(Math.min(CARD_NO_MAX, nextFreeNo + DEFAULT_RUN - 1)))
  const [state, formAction, pending, dismiss] = useDismissibleActionState<CardFormState>(
    async (prev, formData) => {
      const result = await createCardStockRange(prev, formData)
      if (result.success) {
        toast.success(result.success)
        setOpen(false)
      }
      return result
    },
    {}
  )

  function onOpenChange(next: boolean) {
    dismiss()
    if (next) {
      // The free pointer may have moved since the page loaded on a long shift.
      setFrom(String(nextFreeNo))
      setTo(String(Math.min(CARD_NO_MAX, nextFreeNo + DEFAULT_RUN - 1)))
    }
    setOpen(next)
  }

  const fromNo = Number.parseInt(from, 10)
  const toNo = Number.parseInt(to, 10)
  const valid =
    Number.isInteger(fromNo) &&
    Number.isInteger(toNo) &&
    fromNo >= CARD_NO_MIN &&
    toNo <= CARD_NO_MAX &&
    fromNo <= toNo
  const count = valid ? toNo - fromNo + 1 : 0
  const tooMany = valid && count > MAX_RANGE_SIZE

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button />}>Number new cards</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={formAction} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Number new cards</DialogTitle>
            <DialogDescription>
              Reserve a run of printed numbers for the next batch from the print shop. Each
              card gets its chip linked the first time it is tapped on a reader.
            </DialogDescription>
          </DialogHeader>

          <AuthFormMessage error={state.error} />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="range-from">From</Label>
              <Input
                id="range-from"
                name="from"
                inputMode="numeric"
                value={from}
                onChange={(event) => setFrom(event.target.value.replace(/[^0-9]/g, ''))}
                className="font-mono"
                autoComplete="off"
                required
              />
              <FieldError messages={state.fieldErrors?.from} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="range-to">To</Label>
              <Input
                id="range-to"
                name="to"
                inputMode="numeric"
                value={to}
                onChange={(event) => setTo(event.target.value.replace(/[^0-9]/g, ''))}
                className="font-mono"
                autoComplete="off"
                required
              />
              <FieldError messages={state.fieldErrors?.to} />
            </div>
          </div>

          <p className={tooMany ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
            {valid
              ? tooMany
                ? `That is ${count} cards. Number at most ${MAX_RANGE_SIZE} at a time.`
                : `Prints ${cardLabel(fromNo)} – ${cardLabel(toNo)} (${count} ${
                    count === 1 ? 'card' : 'cards'
                  })`
              : `Numbers run from ${CARD_NO_MIN} to ${CARD_NO_MAX}, low to high.`}
          </p>

          <DialogFooter>
            <Button type="submit" disabled={pending || !valid || tooMany}>
              {pending ? 'Numbering...' : 'Number cards'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
