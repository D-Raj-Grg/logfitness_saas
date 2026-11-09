'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { linkCardStockUid, type CardFormState } from '@/app/(app)/cards/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { CardUidPicker, useCardUidPicker } from '@/components/cards/card-uid-picker'
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
import { cardLabel } from '@/lib/cards/card-no'
import type { UnassignedCardScan } from '@/lib/db/member-cards'
import { useDismissibleActionState } from '@/hooks/use-dismissible-action-state'

/**
 * Tell the system which chip sits inside printed card NO. 0004: tap it on a
 * reader and pick the tap, or type the UID off another reader.
 */
export function LinkUidDialog({
  cardNo,
  scans,
}: {
  cardNo: number
  scans: UnassignedCardScan[]
}) {
  const [open, setOpen] = useState(false)
  const picker = useCardUidPicker(scans)
  const [state, formAction, pending, dismiss] = useDismissibleActionState<CardFormState>(
    async (prev, formData) => {
      const result = await linkCardStockUid(prev, formData)
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
    picker.reset()
    setOpen(next)
  }

  const label = cardLabel(cardNo)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Link chip</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="cardNo" value={cardNo} />
          <input type="hidden" name="cardUid" value={picker.cardUid} />

          <DialogHeader>
            <DialogTitle>Link the chip in {label}</DialogTitle>
            <DialogDescription>
              Tap {label} on a reader, then pick that tap below. From then on the readers
              know this chip as {label}.
            </DialogDescription>
          </DialogHeader>

          <AuthFormMessage error={state.error} />

          <CardUidPicker scans={scans} picker={picker} idPrefix={`link-${cardNo}`} />
          <FieldError messages={state.fieldErrors?.cardUid} />

          <DialogFooter>
            <Button type="submit" disabled={pending || !picker.cardUid}>
              {pending ? 'Linking...' : 'Link chip'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
