'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

import {
  assignMemberCard,
  revokeMemberCard,
  type MemberFormState,
} from '@/app/(app)/members/actions'
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
import type { MemberCardRow, UnassignedCardScan } from '@/lib/db/member-cards'
import { formatDate, formatDateTime } from '@/lib/format'
import { useDismissibleActionState } from '@/hooks/use-dismissible-action-state'

const MANUAL = 'manual'

/**
 * Enrollment is a tap, not a typing exercise: the member taps the new card on
 * a reader, the reader does not know it and files it as an unassigned scan, and
 * the desk picks it from this list. Typing the UID is the fallback for a card
 * read some other way.
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
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const [open, setOpen] = useState(false)
  // Null until the desk picks something. Until then the newest tap is selected
  // -- including one that "Check for new taps" just brought in -- else typing.
  const [choice, setChoice] = useState<string | null>(null)
  const [manualUid, setManualUid] = useState('')
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
    setChoice(null)
    setOpen(next)
  }

  // A refresh can also take the chosen tap away (assigned meanwhile); fall
  // back the same way.
  const selected =
    choice === MANUAL || (choice && scans.some((scan) => scan.card_uid === choice))
      ? choice
      : (scans[0]?.card_uid ?? MANUAL)
  const cardUid = selected === MANUAL ? manualUid : selected

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
              Have the member tap the new card on a reader, then pick it below.
              {replacing
                ? ' The card they have now stops working, recorded as replaced.'
                : null}
            </DialogDescription>
          </DialogHeader>

          <AuthFormMessage error={state.error} />

          <fieldset className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <legend className="text-sm font-medium">Recent unknown cards</legend>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={refreshing}
                onClick={() => startRefresh(() => router.refresh())}
              >
                <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
                Check for new taps
              </Button>
            </div>

            {scans.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                No unknown cards tapped in the last week.
              </p>
            ) : (
              <div className="flex max-h-56 flex-col divide-y overflow-y-auto rounded-md border">
                {scans.map((scan) => (
                  <label
                    key={scan.id}
                    className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm has-[:checked]:bg-muted/60"
                  >
                    <input
                      type="radio"
                      name="cardChoice"
                      value={scan.card_uid}
                      checked={selected === scan.card_uid}
                      onChange={() => setChoice(scan.card_uid)}
                      className="mt-1"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-mono break-all">{scan.card_uid}</span>
                      <span className="text-xs text-muted-foreground">
                        {scan.devices?.name ?? 'A reader'} · {formatDateTime(scan.last_seen_at)}
                        {scan.scan_count > 1 ? ` · ${scan.scan_count} taps` : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            <label className="flex cursor-pointer items-center gap-3 px-3 py-1 text-sm">
              <input
                type="radio"
                name="cardChoice"
                value={MANUAL}
                checked={selected === MANUAL}
                onChange={() => setChoice(MANUAL)}
              />
              Type the card number instead
            </label>
          </fieldset>

          {selected === MANUAL ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="manual-card-uid">Card UID</Label>
              <Input
                id="manual-card-uid"
                value={manualUid}
                onChange={(event) => setManualUid(event.target.value)}
                placeholder="04:A3:1B:2C"
                autoComplete="off"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Hex, with or without colons or spaces.
              </p>
            </div>
          ) : null}
          <FieldError messages={state.fieldErrors?.cardUid} />

          <DialogFooter>
            <Button type="submit" disabled={pending || !cardUid}>
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
 */
export function MemberCardAccess({
  memberId,
  cards,
  scans,
}: {
  memberId: string
  cards: MemberCardRow[] | null
  scans: UnassignedCardScan[]
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
