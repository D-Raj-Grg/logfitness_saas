'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { setCardStockStatus, type CardFormState } from '@/app/(app)/cards/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cardLabel } from '@/lib/cards/card-no'
import type { CardStockStatus } from '@/lib/validation/cards'
import { useDismissibleActionState } from '@/hooks/use-dismissible-action-state'

const COPY: Record<
  CardStockStatus,
  { trigger: string; title: (label: string) => string; body: string; confirm: string; busy: string }
> = {
  lost: {
    trigger: 'Mark lost',
    title: (label) => `Mark ${label} as lost?`,
    body: 'It cannot be handed to a member until it turns up again. Say where it went missing.',
    confirm: 'Mark lost',
    busy: 'Marking...',
  },
  retired: {
    trigger: 'Mark retired',
    title: (label) => `Retire ${label}?`,
    body: 'For a card that is damaged or withdrawn for good. Its number stays taken, so no new card prints with it.',
    confirm: 'Retire card',
    busy: 'Retiring...',
  },
  free: {
    trigger: 'Mark found',
    title: (label) => `Put ${label} back in the free pile?`,
    body: 'It can be handed to a member again. Its chip stays linked.',
    confirm: 'Mark found',
    busy: 'Working...',
  },
}

/** Lost, retired, or found again. The RPC refuses while someone holds the card. */
export function StockStatusDialog({
  cardNo,
  status,
  variant = 'ghost',
}: {
  cardNo: number
  status: CardStockStatus
  variant?: 'ghost' | 'outline'
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending, dismiss] = useDismissibleActionState<CardFormState>(
    async (prev, formData) => {
      const result = await setCardStockStatus(prev, formData)
      if (result.success) {
        toast.success(result.success)
        setOpen(false)
      }
      return result
    },
    {}
  )
  const onOpenChange = (next: boolean) => {
    dismiss()
    setOpen(next)
  }

  const copy = COPY[status]
  const label = cardLabel(cardNo)
  const destructive = status !== 'free'

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger render={<Button variant={variant} size="sm" />}>
        {copy.trigger}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="cardNo" value={cardNo} />
          <input type="hidden" name="status" value={status} />
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.title(label)}</AlertDialogTitle>
            <AlertDialogDescription>{copy.body}</AlertDialogDescription>
          </AlertDialogHeader>

          <AuthFormMessage error={state.error} />

          {destructive ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`stock-reason-${cardNo}-${status}`}>Reason</Label>
              <Input
                id={`stock-reason-${cardNo}-${status}`}
                name="reason"
                placeholder={status === 'lost' ? 'Not returned at leaving' : 'Chip stopped reading'}
                maxLength={500}
                required
              />
              <FieldError messages={state.fieldErrors?.reason} />
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              type="submit"
              variant={destructive ? 'destructive' : 'default'}
              disabled={pending}
            >
              {pending ? copy.busy : copy.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
