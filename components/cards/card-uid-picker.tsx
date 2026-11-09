'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCardNo } from '@/lib/cards/card-no'
import type { UnassignedCardScan } from '@/lib/db/member-cards'
import { formatDateTime } from '@/lib/format'

export const MANUAL_UID = 'manual'

/**
 * The picker's state, kept by the dialog that owns it so the dialog can reset
 * it on every open and read the resolved UID for its hidden field.
 *
 * `choice` is null until the desk picks something. Until then the newest tap
 * is selected -- including one that "Check for new taps" just brought in --
 * else typing. A refresh can also take the chosen tap away (assigned
 * meanwhile); the fallback is the same.
 */
export function useCardUidPicker(scans: UnassignedCardScan[]) {
  const [choice, setChoice] = useState<string | null>(null)
  const [manualUid, setManualUid] = useState('')

  const selected =
    choice === MANUAL_UID || (choice && scans.some((scan) => scan.card_uid === choice))
      ? choice
      : (scans[0]?.card_uid ?? MANUAL_UID)
  const cardUid = selected === MANUAL_UID ? manualUid : selected

  function reset() {
    setChoice(null)
    setManualUid('')
  }

  return { selected, setChoice, manualUid, setManualUid, cardUid, reset }
}

/**
 * Enrollment is a tap, not a typing exercise: the card is tapped on a reader,
 * the reader does not know it and files it as an unassigned scan, and the desk
 * picks it from this list. Typing the UID is the fallback for a card read some
 * other way.
 *
 * A tap from a chip that is already linked to a printed card is labelled with
 * that number, because "Card 0004" is what the desk is holding; the UID alone
 * says nothing to a person.
 */
export function CardUidPicker({
  scans,
  picker,
  uidToCardNo,
  idPrefix = 'card-uid',
  legend = 'Recent unknown cards',
}: {
  scans: UnassignedCardScan[]
  picker: ReturnType<typeof useCardUidPicker>
  /** Chip UID -> printed number, for taps the server already matched to stock. */
  uidToCardNo?: Record<string, number>
  idPrefix?: string
  legend?: string
}) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()
  const { selected, setChoice, manualUid, setManualUid } = picker

  function numberFor(scan: UnassignedCardScan) {
    return scan.card_no ?? uidToCardNo?.[scan.card_uid] ?? null
  }

  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <legend className="text-sm font-medium">{legend}</legend>
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
            {scans.map((scan) => {
              const cardNo = numberFor(scan)
              return (
                <label
                  key={scan.id}
                  className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm has-[:checked]:bg-muted/60"
                >
                  <input
                    type="radio"
                    name={`${idPrefix}-choice`}
                    value={scan.card_uid}
                    checked={selected === scan.card_uid}
                    onChange={() => setChoice(scan.card_uid)}
                    className="mt-1"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="break-all">
                      {cardNo !== null ? (
                        <span className="font-medium">Card {formatCardNo(cardNo)} · </span>
                      ) : null}
                      <span className="font-mono">{scan.card_uid}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {scan.devices?.name ?? 'A reader'} · {formatDateTime(scan.last_seen_at)}
                      {scan.scan_count > 1 ? ` · ${scan.scan_count} taps` : ''}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-3 px-3 py-1 text-sm">
          <input
            type="radio"
            name={`${idPrefix}-choice`}
            value={MANUAL_UID}
            checked={selected === MANUAL_UID}
            onChange={() => setChoice(MANUAL_UID)}
          />
          Type the chip UID instead
        </label>
      </fieldset>

      {selected === MANUAL_UID ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-manual`}>Card UID</Label>
          <Input
            id={`${idPrefix}-manual`}
            value={manualUid}
            onChange={(event) => setManualUid(event.target.value)}
            placeholder="04:A3:1B:2C"
            autoComplete="off"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">Hex, with or without colons or spaces.</p>
        </div>
      ) : null}
    </>
  )
}
