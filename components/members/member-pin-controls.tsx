'use client'

import { useState, useTransition } from 'react'
import { Check, Copy, KeyRound } from 'lucide-react'
import { toast } from 'sonner'

import {
  clearMemberPin,
  getMemberPinStatus,
  setMemberPin,
  type MemberPinResult,
  type MemberPinStatus,
} from '@/app/(app)/members/[id]/pin-actions'
import { AuthFormMessage } from '@/components/auth/auth-form-message'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDate, formatDateTime } from '@/lib/format'

type View = 'menu' | 'custom' | 'remove' | 'reveal'

export function pinStatusLabel(status: MemberPinStatus | null) {
  if (!status) return 'Status unavailable'
  if (status.locked_until) return `Locked until ${formatDateTime(status.locked_until)}`
  if (status.has_pin) return status.set_at ? `PIN set ${formatDate(status.set_at)}` : 'PIN set'
  return 'No PIN'
}

const HELPER = 'Member signs in to the LOG Fitness app with card number or phone + this PIN.'

/**
 * Every PIN flow for one member, in one dialog: generate (shown once), set a
 * custom PIN, remove. `card` lays the status and buttons out inline for the
 * member profile; `compact` is one small "PIN" button for a table row, which
 * opens the same flow and reads the status when it opens.
 *
 * A generated PIN exists in exactly one place: this component's `pin` state.
 * It is cleared the moment the dialog closes, and it never goes into a URL,
 * a toast, a log or anything the page revalidates.
 */
export function MemberPinControls({
  memberId,
  fullName,
  initialStatus,
  layout = 'card',
}: {
  memberId: string
  fullName: string
  /** The status the server already read; omitted by the table row, which asks on open. */
  initialStatus?: MemberPinStatus | null
  layout?: 'card' | 'compact'
}) {
  const [status, setStatus] = useState<MemberPinStatus | null>(initialStatus ?? null)
  const [statusKnown, setStatusKnown] = useState(initialStatus !== undefined)
  const [view, setView] = useState<View | null>(null)
  const [pin, setPin] = useState<string | null>(null)
  const [custom, setCustom] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  // The server re-renders the profile after every change with the same status
  // the action just returned, so props only matter until the first action.
  const shown = statusKnown ? status : null
  const hasPin = Boolean(shown?.has_pin)

  function close() {
    // Dropping the PIN here is the whole point of the dialog being modal.
    setPin(null)
    setCustom('')
    setError(null)
    setCopied(false)
    setView(null)
  }

  function absorb(result: MemberPinResult) {
    if (result.error !== undefined) {
      setError(result.error)
      return false
    }
    if (result.status) {
      setStatus(result.status)
      setStatusKnown(true)
    }
    return true
  }

  function openMenu() {
    setError(null)
    setView('menu')
    if (!statusKnown) {
      startTransition(async () => {
        absorb(await getMemberPinStatus(memberId))
      })
    }
  }

  function generate() {
    setError(null)
    startTransition(async () => {
      const result = await setMemberPin(memberId)
      // A refusal shows inline on the card, or in the menu of the row dialog.
      if (!absorb(result)) return
      setPin(result.pin ?? null)
      setView('reveal')
    })
  }

  function saveCustom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await setMemberPin(memberId, custom)
      if (!absorb(result)) return
      toast.success('PIN set.')
      close()
    })
  }

  function remove() {
    setError(null)
    startTransition(async () => {
      const result = await clearMemberPin(memberId)
      if (!absorb(result)) return
      toast.success('PIN removed.')
      close()
    })
  }

  async function copyPin() {
    if (!pin) return
    try {
      await navigator.clipboard.writeText(pin)
      setCopied(true)
    } catch {
      // No clipboard permission: the PIN is still selectable on screen.
      setCopied(false)
    }
  }

  const customValid = /^\d{6}$/.test(custom)

  const actions = (
    <>
      <Button type="button" size="sm" onClick={generate} disabled={pending}>
        {pending && (view === null || view === 'menu') ? 'Working...' : 'Generate new PIN'}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          setError(null)
          setCustom('')
          setView('custom')
        }}
      >
        Set custom PIN
      </Button>
      {hasPin ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => {
            setError(null)
            setView('remove')
          }}
        >
          Remove PIN
        </Button>
      ) : null}
    </>
  )

  return (
    <>
      {layout === 'card' ? (
        <div className="flex flex-col gap-3 rounded-lg border px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Member app PIN</span>
              <span className="text-sm text-muted-foreground">{pinStatusLabel(shown)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          </div>
          <p className="text-xs text-muted-foreground">{HELPER}</p>
          {view === null ? <AuthFormMessage error={error ?? undefined} /> : null}
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Member app PIN for ${fullName}`}
          onClick={openMenu}
        >
          <KeyRound />
          PIN
        </Button>
      )}

      <Dialog
        open={view !== null}
        onOpenChange={(next) => {
          if (!next) close()
        }}
        // A PIN shown once should not be lost to a stray click on the backdrop.
        disablePointerDismissal={view === 'reveal'}
      >
        <DialogContent showCloseButton={view !== 'reveal'}>
          {view === 'reveal' ? (
            <>
              <DialogHeader>
                <DialogTitle>New PIN for {fullName}</DialogTitle>
                <DialogDescription>
                  Tell the member this PIN now. It will not be shown again.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code
                  data-testid="generated-pin"
                  className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-center font-mono text-2xl tracking-[0.3em] select-all"
                >
                  {pin}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={copyPin}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? 'Copied' : 'Copy PIN'}
                </Button>
              </div>
              <p
                role="status"
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
              >
                Once you close this, the PIN cannot be read back. If it is lost, generate a new
                one.
              </p>
              <p className="text-xs text-muted-foreground">{HELPER}</p>
              <DialogFooter>
                <Button type="button" onClick={close}>
                  Done
                </Button>
              </DialogFooter>
            </>
          ) : view === 'custom' ? (
            <form onSubmit={saveCustom} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>Set a PIN for {fullName}</DialogTitle>
                <DialogDescription>
                  Exactly 6 digits. It replaces any PIN they have now and clears a lock.
                </DialogDescription>
              </DialogHeader>
              <AuthFormMessage error={error ?? undefined} />
              <div className="flex flex-col gap-2">
                <Label htmlFor={`member-pin-${memberId}`}>PIN</Label>
                <Input
                  id={`member-pin-${memberId}`}
                  value={custom}
                  onChange={(event) => setCustom(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  placeholder="6 digits"
                  autoComplete="off"
                  autoFocus
                  required
                  className="font-mono tracking-widest"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" disabled={pending} onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || !customValid}>
                  {pending ? 'Saving...' : 'Set PIN'}
                </Button>
              </DialogFooter>
            </form>
          ) : view === 'remove' ? (
            <>
              <DialogHeader>
                <DialogTitle>Remove {fullName}&apos;s PIN?</DialogTitle>
                <DialogDescription>
                  They will not be able to sign in to the app until a new PIN is set.
                </DialogDescription>
              </DialogHeader>
              <AuthFormMessage error={error ?? undefined} />
              <DialogFooter>
                <Button type="button" variant="outline" disabled={pending} onClick={close}>
                  Cancel
                </Button>
                <Button type="button" variant="destructive" disabled={pending} onClick={remove}>
                  {pending ? 'Removing...' : 'Remove PIN'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Member app PIN</DialogTitle>
                <DialogDescription>
                  {fullName} · {pinStatusLabel(shown)}
                </DialogDescription>
              </DialogHeader>
              <AuthFormMessage error={error ?? undefined} />
              <div className="flex flex-wrap items-center gap-2">{actions}</div>
              <p className="text-xs text-muted-foreground">{HELPER}</p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
