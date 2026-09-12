'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'

import {
  previewVisitorMessage,
  sendVisitorMessage,
  type VisitorMessageState,
} from '@/app/(app)/visitors/message-actions'
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
  smsSegments,
  VISITOR_EVENT_LABELS,
  VISITOR_EVENTS,
  type VisitorEvent,
} from '@/lib/notifications/messages'

/**
 * One SMS to one walk-in.
 *
 * The member dialog's twin, and deliberately so: same preview-then-edit shape,
 * same segment counter, same disabled-send banner carrying the reason. The
 * wording is rendered in Postgres from the gym's own template, so a welcome
 * sent by hand reads exactly like the one the insert would have sent.
 */
export function VisitorMessageDialog({
  visitorId,
  fullName,
  open,
  onOpenChange,
}: {
  visitorId: string
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
          <VisitorMessageForm visitorId={visitorId} onSent={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function VisitorMessageForm({
  visitorId,
  onSent,
}: {
  visitorId: string
  onSent: () => void
}) {
  const [state, formAction, pending] = useActionState<VisitorMessageState, FormData>(
    sendVisitorMessage,
    {}
  )
  const [event, setEvent] = useState<VisitorEvent>('visitor_welcome')
  const [body, setBody] = useState('')
  const [toAddress, setToAddress] = useState<string | null>(null)
  const [blocker, setBlocker] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, startLoading] = useTransition()

  useEffect(() => {
    if (state.success) onSent()
  }, [state.success, onSent])

  useEffect(() => {
    let current = true

    startLoading(async () => {
      const result = await previewVisitorMessage(visitorId, event)
      if (!current) return

      if (result.error || !result.preview) {
        setLoadError(result.error ?? 'That visitor is not in your gym.')
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
        !preview.reachable
          ? 'The number on file is not a mobile number this can be sent to.'
          : !preview.has_gateway
            ? 'No SMS gateway is set up yet. An owner configures one in Settings.'
            : null
      )
    })

    return () => {
      current = false
    }
  }, [visitorId, event])

  const segments = smsSegments(body)
  const blocked = Boolean(blocker) || Boolean(loadError)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="visitorId" value={visitorId} />
      <input type="hidden" name="channel" value="sms" />
      <input type="hidden" name="event" value={event} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="visitor-message-event">Reason</Label>
        <Select
          value={event}
          onValueChange={(value) => setEvent(String(value) as VisitorEvent)}
        >
          <SelectTrigger id="visitor-message-event">
            <SelectValue>{VISITOR_EVENT_LABELS[event]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {VISITOR_EVENTS.map((option) => (
              <SelectItem key={option} value={option}>
                {VISITOR_EVENT_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError messages={state.fieldErrors?.event} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="visitor-message-body">Message</Label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {toAddress ? `To ${toAddress} · ` : ''}
            {body.length} characters · {segments.count} SMS
            {segments.unicode ? ' (Nepali)' : ''}
          </span>
        </div>
        <Textarea
          id="visitor-message-body"
          name="body"
          rows={5}
          value={body}
          onChange={(item) => setBody(item.target.value)}
          placeholder={
            loading ? 'Reading the gym’s wording…' : 'What should this visitor be told?'
          }
          disabled={loading}
        />
        <FieldError messages={state.fieldErrors?.body} />
        <p className="text-xs text-muted-foreground">
          Sent as written. Edit it for this one person if you need to; the gym’s
          template is not changed.
        </p>
      </div>

      <AuthFormMessage error={state.error ?? loadError ?? blocker ?? undefined} />

      <DialogFooter>
        <Button
          type="submit"
          disabled={pending || loading || blocked || body.trim().length === 0}
        >
          {pending ? 'Sending…' : 'Send SMS'}
        </Button>
      </DialogFooter>
    </form>
  )
}
