'use client'

import { useActionState, useEffect, useRef, useState } from 'react'

import {
  checkIn,
  searchMembers,
  type CheckInActionState,
} from '@/app/(app)/check-in/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { CheckInResultBanner } from '@/components/attendance/check-in-result'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'

type Candidate = Awaited<ReturnType<typeof searchMembers>>['members'][number]

const MIN_TERM = 2
const DEBOUNCE_MS = 200

/**
 * The whole screen in one box. Type a phone, name, or code; arrow to the right
 * person; press Enter. Nothing else stands between the desk and a check-in,
 * because the PRD budget for the whole interaction is three seconds.
 */
export function CheckInConsole({
  branchId,
  branchName,
}: {
  /** Null when an owner is looking at every branch; the member's home branch is used then. */
  branchId: string | null
  branchName: string | null
}) {
  const [state, formAction, pending] = useActionState<CheckInActionState, FormData>(
    checkIn,
    {}
  )

  const [term, setTerm] = useState('')
  const [results, setResults] = useState<Candidate[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [searching, setSearching] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [handledState, setHandledState] = useState<CheckInActionState | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  // The type-ahead is a server action, so responses can land out of order.
  // Only the newest query is allowed to paint.
  const requestId = useRef(0)
  const focusedFor = useRef<CheckInActionState | null>(null)

  // A fresh action state means a fresh verdict: show it and empty the box. This
  // is the "adjust state when the input changes" pattern -- an effect here would
  // paint the stale search list for a frame first, which at this speed is a
  // misread waiting to happen.
  if (handledState !== state) {
    setHandledState(state)
    if (state.result) {
      setTerm('')
      setResults([])
      setActiveIndex(0)
      setSearching(false)
      setDismissed(false)
    }
  }

  useEffect(() => {
    const cleaned = term.trim()
    if (cleaned.length < MIN_TERM) return

    const id = ++requestId.current
    const timer = setTimeout(async () => {
      try {
        const { members } = await searchMembers(cleaned)
        if (id !== requestId.current) return
        setResults(members)
        setActiveIndex(0)
      } catch {
        if (id === requestId.current) setResults([])
      } finally {
        if (id === requestId.current) setSearching(false)
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [term])

  // Put the cursor back so the next member can be served without a mouse.
  useEffect(() => {
    if (focusedFor.current === state) return
    focusedFor.current = state
    if (state.result?.ok) inputRef.current?.focus()
  }, [state])

  function changeTerm(next: string) {
    setTerm(next)
    setDismissed(true)
    if (next.trim().length < MIN_TERM) {
      requestId.current += 1
      setResults([])
      setSearching(false)
    } else {
      setSearching(true)
    }
  }

  function submit(memberId: string, memberBranchId: string, override?: string) {
    // Retire any in-flight search so a late response cannot repaint the list
    // over the verdict the desk is about to read.
    requestId.current += 1

    const formData = new FormData()
    formData.set('memberId', memberId)
    formData.set('branchId', memberBranchId)
    formData.set('method', 'manual')
    if (override) {
      formData.set('override', 'on')
      formData.set('overrideReason', override)
    }
    formAction(formData)
  }

  function pick(candidate: Candidate | undefined) {
    if (!candidate || pending) return
    submit(candidate.id, branchId ?? candidate.home_branch_id)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(results[activeIndex])
    } else if (event.key === 'Escape') {
      setResults([])
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="check-in-search" className="text-base">
          Check in a member
        </Label>
        <Input
          id="check-in-search"
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="check-in-results"
          aria-autocomplete="list"
          autoFocus
          autoComplete="off"
          placeholder="Phone, name or member ID"
          className="h-14 text-lg md:text-lg"
          value={term}
          onChange={(event) => changeTerm(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground">
          {branchName
            ? `Checking in at ${branchName}. Arrow keys to choose, Enter to check in.`
            : 'Every branch selected — each member is checked in at their home branch.'}
        </p>
        <FieldError messages={state.fieldErrors?.branchId} />
        <FieldError messages={state.fieldErrors?.memberId} />
      </div>

      <AuthFormMessage error={state.error} />

      {term.trim().length >= MIN_TERM ? (
        <ul
          id="check-in-results"
          role="listbox"
          aria-label="Matching members"
          className="divide-y overflow-hidden rounded-lg border"
        >
          {results.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              {searching ? 'Searching...' : 'Nobody matches that. Try a shorter phone prefix.'}
            </li>
          ) : (
            results.map((candidate, index) => (
              <li key={candidate.id} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  disabled={pending}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(candidate)}
                  className={cn(
                    'flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors',
                    'hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                    index === activeIndex && 'bg-muted'
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{candidate.full_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <span className="font-mono">{candidate.member_code}</span>
                      {' · '}
                      <span className="tabular-nums">{candidate.phone}</span>
                      {' · '}
                      {candidate.home_branch_name}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {candidate.due_paisa > 0 ? (
                      <span className="text-sm font-medium tabular-nums text-destructive">
                        {formatMoney(candidate.due_paisa)} due
                      </span>
                    ) : null}
                    <Badge
                      variant={
                        candidate.status === 'active'
                          ? 'default'
                          : candidate.status === 'frozen'
                            ? 'outline'
                            : 'destructive'
                      }
                    >
                      {candidate.current_plan_name ?? 'No plan'}
                    </Badge>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}

      {state.result && !dismissed ? (
        <CheckInResultBanner
          result={state.result}
          pending={pending}
          fieldErrors={state.fieldErrors}
          onOverride={(reason) =>
            state.result
              ? submit(state.result.member.id, state.result.branch.id, reason)
              : undefined
          }
        />
      ) : null}
    </div>
  )
}
