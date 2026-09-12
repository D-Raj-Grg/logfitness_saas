'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'

import {
  previewMemberMessage,
  sendMemberMessage,
  type MemberMessageState,
} from '@/app/(app)/members/[id]/message-actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  MANUAL_EVENTS,
  MANUAL_EVENT_LABELS,
  smsSegments,
  type ManualEvent,
} from '@/lib/notifications/messages'

/**
 * One SMS to one member, now.
 *
 * The wording is not assembled here. It is rendered in Postgres from the gym's
 * own template and this member's real figures, so what the desk reads before
 * pressing Send is what the nightly sweep would have sent -- and the desk may
 * edit it, because the text that goes out is the text stored in the log.
 *
 * Everything that would stop the send is reported by the same preview call:
 * the member opted out, their number will not normalise, or no gateway is
 * configured. Send is disabled with the reason on screen rather than offering
 * a button that the database is going to refuse.
 */
export function MemberMessageDialog({
  memberId,
  fullName,
  open,
  onOpenChange,
}: {
  memberId: string
  fullName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send an SMS</DialogTitle>
          <DialogDescription>To {fullName}, now.</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so the wording and the action state are
            fresh every time rather than carrying the last send's message. */}
        {open ? (
          <MemberMessageForm
            memberId={memberId}
            onSent={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function MemberMessageForm({
  memberId,
  onSent,
}: {
  memberId: string
  onSent: () => void
}) {
  const router = useRouter()
  const [state, formAction, pending] = useActionState<MemberMessageState, FormData>(
    sendMemberMessage,
    {}
  )
  const [event, setEvent] = useState<ManualEvent>('dues_reminder')
  const [body, setBody] = useState('')
  const [toAddress, setToAddress] = useState<string | null>(null)
  const [blocker, setBlocker] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, startLoading] = useTransition()

  /**
   * A send that closes the dialog and says nothing is indistinguishable from a
   * send that never happened -- which is exactly how this read the first time
   * someone used it, on a member whose Messages tab stayed at (0) because the
   * message had gone to the row above. Success and refusal both speak now, and
   * the refresh is what makes the Messages tab and the log show the new row
   * without the desk reloading the page.
   */
  useEffect(() => {
    if (state.error) toast.error(state.error)
    if (!state.success) return

    toast.success(state.success)
    router.refresh()
    onSent()
  }, [state.success, state.error, router, onSent])

  useEffect(() => {
    let current = true

    startLoading(async () => {
      const result = await previewMemberMessage(memberId, event)
      if (!current) return

      if (result.error || !result.preview) {
        setLoadError(result.error ?? 'That member is not in your gym.')
        setBlocker(null)
        setBody('')
        return
      }

      const preview = result.preview
      setLoadError(null)
      setToAddress(preview.to_address)
      // A custom message has no template to render; the desk writes it.
      setBody(preview.body ?? '')
      setBlocker(
        preview.opt_out
          ? 'This member has asked not to receive messages.'
          : !preview.reachable
            ? 'The number on file is not a mobile number this can be sent to.'
            : !preview.has_gateway
              ? 'No SMS gateway is set up yet. An owner configures one in Settings.'
              : null
      )
    })

    return () => {
      current = false
    }
  }, [memberId, event])

  const segments = smsSegments(body)
  const blocked = Boolean(blocker) || Boolean(loadError)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="channel" value="sms" />
      <input type="hidden" name="event" value={event} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="member-message-event">Reason</Label>
        <Select
          value={event}
          onValueChange={(value) => setEvent(String(value) as ManualEvent)}
        >
          <SelectTrigger id="member-message-event">
            <SelectValue>{MANUAL_EVENT_LABELS[event]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {MANUAL_EVENTS.map((option) => (
              <SelectItem key={option} value={option}>
                {MANUAL_EVENT_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError messages={state.fieldErrors?.event} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="member-message-body">Message</Label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {toAddress ? `To ${toAddress} · ` : ''}
            {body.length} characters · {segments.count} SMS
            {segments.unicode ? ' (Nepali)' : ''}
          </span>
        </div>
        <Textarea
          id="member-message-body"
          name="body"
          rows={5}
          value={body}
          onChange={(item) => setBody(item.target.value)}
          placeholder={loading ? 'Reading the gym’s wording…' : 'What should this member be told?'}
          disabled={loading}
        />
        <FieldError messages={state.fieldErrors?.body} />
        <p className="text-xs text-muted-foreground">
          Sent as written. Edit the standard wording if this member needs
          something else; the gym’s template is not changed.
        </p>
      </div>

      <AuthFormMessage error={state.error ?? loadError ?? blocker ?? undefined} />

      <DialogFooter>
        <Button type="submit" disabled={pending || loading || blocked || body.trim().length === 0}>
          {pending ? 'Sending…' : 'Send SMS'}
        </Button>
      </DialogFooter>
    </form>
  )
}
