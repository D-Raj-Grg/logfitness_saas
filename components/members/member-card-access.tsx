'use client'

import { useState } from 'react'

import {
  assignMemberCard,
  revokeMemberCard,
  type MemberFormState,
} from '@/app/(app)/members/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { CardUidPicker, useCardUidPicker } from '@/components/cards/card-uid-picker'
import { useCardStockLookup } from '@/components/cards/use-card-stock-lookup'
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
import { cardLabel, parseCardNo } from '@/lib/cards/card-no'
import type { MemberCardRow, UnassignedCardScan } from '@/lib/db/member-cards'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useDismissibleActionState } from '@/hooks/use-dismissible-action-state'

/**
 * Hand a member a card. The desk starts from the number printed on it: a
 * numbered card whose chip is already linked needs nothing more, one whose
 * chip is not linked yet also needs a tap (or a typed UID), and a card with no
 * printed number is picked from the taps alone, as before.
 */
function AssignCardDialog({
  memberId,
  replacing,
  scans,
}: {
  memberId: string
  replacing: boolean
  scans: UnassignedCardScan[]
}) {
  const [open, setOpen] = useState(false)
  const picker = useCardUidPicker(scans)
  const {
    text: cardNoText,
    setText: setCardNoText,
    lookup,
    pending: looking,
    reset: resetCardNo,
  } = useCardStockLookup()
  const [state, formAction, pending, dismiss] = useDismissibleActionState<MemberFormState>(
    async (prev, formData) => {
      const result = await assignMemberCard(prev, formData)
      if (result.success) setOpen(false)
      return result
    },
    {}
  )

  function onOpenChange(next: boolean) {
    dismiss()
    // Every opening starts from the newest tap, not from last time's pick.
    picker.reset()
    resetCardNo()
    setOpen(next)
  }

  const typedNo = parseCardNo(cardNoText)
  const hasNumber = cardNoText.trim() !== ''
  // A numbered card with its chip linked wants no UID: the number alone is
  // the whole instruction. Otherwise the picker supplies it.
  const chipKnown = Boolean(lookup?.found && lookup.hasChip)
  const needsUid = !hasNumber || (lookup?.found === true && !lookup.hasChip)
  const cardUid = needsUid ? picker.cardUid : ''

  const unusable =
    lookup?.found === true &&
    (lookup.effectiveStatus === 'assigned' ||
      lookup.effectiveStatus === 'lost' ||
      lookup.effectiveStatus === 'retired')
  const canSubmit =
    !pending &&
    !looking &&
    (hasNumber
      ? typedNo !== null && !unusable && lookup?.found === true && (chipKnown || Boolean(cardUid))
      : Boolean(cardUid))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        {replacing ? 'Replace card' : 'Assign card'}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="replace" value={replacing ? 'true' : 'false'} />
          <input type="hidden" name="cardUid" value={cardUid} />

          <DialogHeader>
            <DialogTitle>{replacing ? 'Replace their card' : 'Assign a card'}</DialogTitle>
            <DialogDescription>
              Type the number printed on the card. If it has not been tapped on a reader yet,
              have the member tap it and pick it below.
              {replacing ? ' The card they have now stops working, recorded as replaced.' : null}
            </DialogDescription>
          </DialogHeader>

          <AuthFormMessage error={state.error} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="assign-card-no">Printed card number</Label>
            <Input
              id="assign-card-no"
              name="cardNo"
              value={cardNoText}
              onChange={(event) => setCardNoText(event.target.value)}
              placeholder="e.g. 0004"
              inputMode="numeric"
              autoComplete="off"
              className="font-mono"
              aria-describedby="assign-card-no-hint"
            />
            <p
              id="assign-card-no-hint"
              className={cn(
                'text-xs',
                unusable || lookup?.found === false ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              {!hasNumber
                ? 'Leave blank for a card with no printed number.'
                : typedNo === null
                  ? 'Enter the number printed on the card (1–9999)'
                  : looking || !lookup
                    ? 'Looking up the card...'
                    : !lookup.found
                      ? lookup.label
                      : lookup.effectiveStatus === 'free' && !lookup.hasChip
                        ? `${lookup.label} has no chip linked yet — tap it on a reader or type its UID`
                        : `${lookup.label} · ${lookup.summary}`}
            </p>
            <FieldError messages={state.fieldErrors?.cardNo} />
          </div>

          {needsUid ? (
            <CardUidPicker scans={scans} picker={picker} idPrefix="assign-card-uid" />
          ) : null}
          <FieldError messages={state.fieldErrors?.cardUid} />

          <DialogFooter>
            <Button type="submit" disabled={!canSubmit}>
              {pending ? 'Saving...' : replacing ? 'Replace card' : 'Assign card'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RevokeCardDialog({ memberId, cardUid }: { memberId: string; cardUid: string }) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending, dismiss] = useDismissibleActionState<MemberFormState>(
    async (prev, formData) => {
      const result = await revokeMemberCard(prev, formData)
      if (result.success) setOpen(false)
      return result
    },
    {}
  )
  const onOpenChange = (next: boolean) => {
    dismiss()
    setOpen(next)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>Revoke</AlertDialogTrigger>
      <AlertDialogContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="memberId" value={memberId} />
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke card {cardUid}?</AlertDialogTitle>
            <AlertDialogDescription>
              The readers refuse it from the next tap. The card stays on this member&apos;s
              history with the reason you give.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AuthFormMessage error={state.error} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="revoke-card-reason">Reason</Label>
            <Input
              id="revoke-card-reason"
              name="reason"
              placeholder="Lost card"
              maxLength={500}
              required
            />
            <FieldError messages={state.fieldErrors?.reason} />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Revoking...' : 'Revoke card'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * The member's door card, beside the app access row. `cards` is the member's
 * whole card history, newest first; at most one of them is live. Null means it
 * could not be read, and the row says so instead of guessing "no card".
 * `cardNo` is the number printed on the live card, when it is a numbered one.
 */
export function MemberCardAccess({
  memberId,
  cards,
  scans,
  cardNo = null,
}: {
  memberId: string
  cards: MemberCardRow[] | null
  scans: UnassignedCardScan[]
  cardNo?: number | null
}) {
  if (!cards) {
    return (
      <div className="flex flex-col gap-0.5 rounded-lg border px-4 py-3">
        <span className="text-sm font-medium">Access card</span>
        <span className="text-sm text-muted-foreground">
          The card details could not be loaded. Refresh the page to try again.
        </span>
      </div>
    )
  }

  const live = cards.find((card) => !card.revoked_at) ?? null
  const lastRevoked = live ? null : (cards[0] ?? null)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">Access card</span>
        <span className="text-sm break-words text-muted-foreground">
          {live ? (
            <>
              {cardNo ? (
                <>
                  <span className="font-mono font-semibold text-foreground">
                    {cardLabel(cardNo)}
                  </span>
                  {' · '}
                </>
              ) : null}
              <span className="font-mono">{live.card_uid}</span> · since{' '}
              {formatDate(live.assigned_at)}
            </>
          ) : lastRevoked?.revoked_at ? (
            `No card. The last one was revoked on ${formatDate(lastRevoked.revoked_at)}${
              lastRevoked.revoke_reason ? ` (${lastRevoked.revoke_reason})` : ''
            }.`
          ) : (
            'No card assigned'
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {live ? <RevokeCardDialog memberId={memberId} cardUid={live.card_uid} /> : null}
        <AssignCardDialog memberId={memberId} replacing={Boolean(live)} scans={scans} />
      </div>
    </div>
  )
}
