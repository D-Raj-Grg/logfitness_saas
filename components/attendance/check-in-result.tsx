'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

import { FieldError } from '@/components/auth/auth-form-message'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  BANNER_ADVICE,
  BANNER_LABELS,
  bannerBadgeVariant,
  bannerTone,
  type CheckInBanner,
} from '@/lib/attendance'
import type { CheckInResult } from '@/lib/db/attendance'
import { formatDate, formatMoney, formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Tones reuse the tokens the rest of the console uses: primary for "walk in",
 * amber for "sell the renewal now", destructive for "stop".
 */
const CARD_TONE: Record<ReturnType<typeof bannerTone>, string> = {
  ok: 'border-primary/40 bg-primary/5',
  warn: 'border-amber-500/40 bg-amber-500/10',
  stop: 'border-destructive/30 bg-destructive/10',
}

const TEXT_TONE: Record<ReturnType<typeof bannerTone>, string> = {
  ok: 'text-foreground',
  warn: 'text-amber-700 dark:text-amber-400',
  stop: 'text-destructive',
}

function membershipLine(result: CheckInResult) {
  const membership = result.membership
  if (!membership) return 'No plan on file'

  if (membership.plan_type === 'session_pack') {
    const left = membership.sessions_remaining ?? 0
    return `${membership.plan_name} · ${left} session${left === 1 ? '' : 's'} left`
  }

  if (!membership.end_date) return membership.plan_name

  const days = membership.days_to_expiry
  const tail =
    days === null
      ? ''
      : days < 0
        ? ` · expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
        : days === 0
          ? ' · expires today'
          : ` · ${days} day${days === 1 ? '' : 's'} left`

  return `${membership.plan_name} · ends ${formatDate(membership.end_date)}${tail}`
}

export function CheckInResultBanner({
  result,
  pending,
  fieldErrors,
  onOverride,
}: {
  result: CheckInResult
  pending: boolean
  fieldErrors?: Record<string, string[]>
  /** Re-submits the same member with `override='on'` and this reason. */
  onOverride: (reason: string) => void
}) {
  const banner: CheckInBanner = result.banner
  const tone = bannerTone(banner)
  const duplicate = result.reason === 'already_checked_in'
  const dues = result.due_paisa
  const memberHref = `/members/${result.member.id}`

  const [reason, setReason] = useState('')
  const reasonRef = useRef<HTMLInputElement>(null)

  // A duplicate is the one case where the desk has to type before it can act,
  // so the cursor goes there instead of back to the search box.
  useEffect(() => {
    if (duplicate) reasonRef.current?.focus()
  }, [duplicate, result.member.id])

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('rounded-xl border p-5', duplicate ? CARD_TONE.warn : CARD_TONE[tone])}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={memberHref}
              className="text-2xl font-semibold underline-offset-4 hover:underline"
            >
              {result.member.full_name}
            </Link>
            <Badge variant={bannerBadgeVariant(banner)}>{BANNER_LABELS[banner]}</Badge>
            {result.attendance?.is_override ? (
              <Badge variant="outline">Override</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{result.member.member_code}</span>
            {' · '}
            <span className="tabular-nums">{result.member.phone}</span>
            {' · '}
            {result.branch.name}
          </p>
          <p className={cn('mt-2 text-sm font-medium', TEXT_TONE[tone])}>
            {BANNER_ADVICE[banner]}
          </p>
          <p className="mt-1 text-sm">{membershipLine(result)}</p>
        </div>

        <div className="text-right">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Outstanding dues
          </p>
          <p
            className={cn(
              'text-2xl font-semibold tabular-nums',
              dues > 0 ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {dues > 0 ? formatMoney(dues) : formatMoney(0)}
          </p>
          {result.ok && result.attendance ? (
            <p className="mt-1 text-xs whitespace-nowrap text-muted-foreground">
              Checked in at {formatTime(result.attendance.checked_in_at)}
            </p>
          ) : null}
        </div>
      </div>

      {duplicate ? (
        <div className="mt-4 border-t pt-4">
          <p className="text-sm font-medium">
            Already checked in at{' '}
            <span className="whitespace-nowrap tabular-nums">
              {result.existing ? formatTime(result.existing.checked_in_at) : '--'}
            </span>
            {result.existing?.checked_out_at ? (
              <span className="text-muted-foreground">
                {' '}
                (left at{' '}
                <span className="whitespace-nowrap tabular-nums">
                  {formatTime(result.existing.checked_out_at)}
                </span>
                )
              </span>
            ) : (
              <span className="text-muted-foreground"> and still inside</span>
            )}
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="flex min-w-64 flex-1 flex-col gap-2">
              <Label htmlFor="override-reason">Reason for a second entry</Label>
              <Input
                id="override-reason"
                ref={reasonRef}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && reason.trim()) {
                    event.preventDefault()
                    onOverride(reason.trim())
                  }
                }}
                placeholder="Came back for an evening class"
                maxLength={500}
                autoComplete="off"
              />
              <FieldError messages={fieldErrors?.overrideReason} />
            </div>
            <Button
              type="button"
              disabled={pending || !reason.trim()}
              onClick={() => onOverride(reason.trim())}
            >
              {pending ? 'Checking in...' : 'Check in again'}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {dues > 0 || banner !== 'active' ? (
          <Button
            variant={tone === 'stop' ? 'default' : 'outline'}
            render={<Link href={memberHref} />}
          >
            {dues > 0 ? 'Renew / take payment' : 'Renew membership'}
          </Button>
        ) : null}
        <Button variant="ghost" render={<Link href={memberHref} />}>
          Open profile
        </Button>
      </div>
    </div>
  )
}
