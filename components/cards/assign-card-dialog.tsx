'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  assignCardToMember,
  searchMembersForCard,
  type CardFormState,
  type CardMemberHit,
} from '@/app/(app)/cards/actions'
import { AuthFormMessage } from '@/components/auth/auth-form-message'
import { Spinner } from '@/components/app/spinner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { cardLabel } from '@/lib/cards/card-no'
import { cn } from '@/lib/utils'
import { useDismissibleActionState } from '@/hooks/use-dismissible-action-state'

/**
 * Hand a free, chip-linked card to a member from the card list: find them
 * the way the check-in box does (phone, name, or code), pick, confirm. A
 * member who already holds a card needs "Replace" ticked, or the RPC refuses.
 */
export function AssignCardDialog({ cardNo }: { cardNo: number }) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<CardMemberHit[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<CardMemberHit | null>(null)
  const [replace, setReplace] = useState(false)
  const requestId = useRef(0)
  const [state, formAction, pending, dismiss] = useDismissibleActionState<CardFormState>(
    async (prev, formData) => {
      const result = await assignCardToMember(prev, formData)
      if (result.success) {
        toast.success(result.success)
        setOpen(false)
      }
      return result
    },
    {}
  )

  // The synchronous half of a keystroke: a term too short to search drops
  // the old hits at once, and any answer still in flight is disowned.
  function onTermChange(next: string) {
    setTerm(next)
    setPicked(null)
    requestId.current += 1
    const searchable = next.trim().length >= 2
    setSearching(searchable)
    if (!searchable) setHits([])
  }

  function onOpenChange(next: boolean) {
    dismiss()
    onTermChange('')
    setReplace(false)
    setOpen(next)
  }

  // Same shape as the check-in console: wait for the typing to stop, then one
  // server round trip under the caller's RLS. A stale answer never lands.
  useEffect(() => {
    const cleaned = term.trim()
    if (cleaned.length < 2) return
    const id = requestId.current
    const timer = setTimeout(async () => {
      try {
        const { members } = await searchMembersForCard(cleaned)
        if (id === requestId.current) setHits(members)
      } catch {
        if (id === requestId.current) setHits([])
      } finally {
        if (id === requestId.current) setSearching(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [term])

  const label = cardLabel(cardNo)
  const holdsCard = Boolean(picked?.card_no)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Assign to member</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="cardNo" value={cardNo} />
          <input type="hidden" name="memberId" value={picked?.id ?? ''} />
          <input type="hidden" name="replace" value={replace ? 'true' : 'false'} />

          <DialogHeader>
            <DialogTitle>Assign {label}</DialogTitle>
            <DialogDescription>
              Find the member who is taking this card. Door access then follows their
              membership status and dues.
            </DialogDescription>
          </DialogHeader>

          <AuthFormMessage error={state.error} />

          <div className="flex flex-col gap-2">
            <Label htmlFor={`assign-member-${cardNo}`}>Member</Label>
            <div className="relative">
              <Input
                id={`assign-member-${cardNo}`}
                type="search"
                value={term}
                onChange={(event) => onTermChange(event.target.value)}
                placeholder="Phone, name, or member code"
                autoComplete="off"
                className="pr-9"
              />
              {searching ? (
                <Spinner
                  label="Searching members"
                  className="absolute top-1/2 right-3 -translate-y-1/2"
                />
              ) : null}
            </div>

            {picked ? (
              <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{picked.full_name}</span>
                  <span className="text-xs text-muted-foreground">
                    <span className="font-mono">{picked.member_code}</span> ·{' '}
                    <span className="tabular-nums">{picked.phone}</span>
                    {picked.card_no ? ` · holds ${cardLabel(picked.card_no)}` : ''}
                  </span>
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(null)}>
                  Change
                </Button>
              </div>
            ) : term.trim().length >= 2 && !searching && hits.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                No members match.
              </p>
            ) : hits.length > 0 ? (
              <div
                role="listbox"
                aria-label="Matching members"
                className="flex max-h-56 flex-col divide-y overflow-y-auto rounded-md border"
              >
                {hits.map((hit) => (
                  <button
                    key={hit.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => setPicked(hit)}
                    className={cn(
                      'flex flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none'
                    )}
                  >
                    <span className="font-medium">{hit.full_name}</span>
                    <span className="text-xs text-muted-foreground">
                      <span className="font-mono">{hit.member_code}</span> ·{' '}
                      <span className="tabular-nums">{hit.phone}</span>
                      {hit.card_no ? ` · holds ${cardLabel(hit.card_no)}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={replace}
              onCheckedChange={(checked) => setReplace(checked === true)}
            />
            Replace their existing card
            {holdsCard ? (
              <span className="text-xs text-muted-foreground">(they hold one now)</span>
            ) : null}
          </label>

          <DialogFooter>
            <Button type="submit" disabled={pending || !picked || (holdsCard && !replace)}>
              {pending ? 'Assigning...' : `Assign ${label}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
