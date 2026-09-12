'use client'

import { useActionState, useState } from 'react'

import {
  resetNotificationTemplate,
  saveNotificationTemplate,
  type NotificationSettingsState,
} from '@/app/(app)/settings/notifications/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { NotificationEvent } from '@/lib/db/notifications'
import { smsSegments } from '@/lib/notifications/messages'

export type TemplateSlot = {
  event: NotificationEvent
  /** The org's own row, when it has edited this one. */
  templateId: string | null
  body: string
  locale: string
}

const EVENT_LABELS: Partial<Record<NotificationEvent, string>> = {
  renewal_reminder: 'Renewal reminder',
  dues_reminder: 'Dues reminder',
  birthday_greeting: 'Birthday greeting',
  visitor_welcome: 'Visitor welcome',
  visitor_follow_up: 'Visitor follow-up',
}

/** Which placeholders actually carry a value for each reason. */
const VARIABLES: Partial<Record<NotificationEvent, string[]>> = {
  renewal_reminder: ['member_name', 'gym_name', 'branch_name', 'plan_name', 'end_date', 'days_left'],
  dues_reminder: ['member_name', 'gym_name', 'branch_name', 'due_amount'],
  birthday_greeting: ['member_name', 'gym_name', 'branch_name'],
  visitor_welcome: ['visitor_name', 'gym_name', 'branch_name', 'plan_name', 'visited_on'],
  visitor_follow_up: ['visitor_name', 'gym_name', 'branch_name', 'plan_name', 'visited_on'],
}

const SAMPLE: Record<string, string> = {
  member_name: 'Ram Thapa',
  gym_name: 'Lord of Gyms',
  branch_name: 'Thamel',
  plan_name: 'Monthly',
  end_date: '16 Sep 2026',
  days_left: '7',
  due_amount: 'Rs 2,000',
  visitor_name: 'Bina Gurung',
  visited_on: '12 Sep 2026',
}

/**
 * A rough preview only. The message that actually goes out is rendered in
 * Postgres by render_notification_template, so the nightly sweep and the
 * Flutter app see identical wording; this is here to show the shape while
 * someone is typing.
 */
function preview(body: string) {
  return body
    .replace(/\{\{([a-z_]+)\}\}/g, (_match, key: string) => SAMPLE[key] ?? '')
    .replace(/ {2,}/g, ' ')
    .trim()
}

function TemplateCard({ slot }: { slot: TemplateSlot }) {
  const [state, formAction, pending] = useActionState<NotificationSettingsState, FormData>(
    saveNotificationTemplate,
    {}
  )
  const [resetState, resetAction] = useActionState<NotificationSettingsState, FormData>(
    resetNotificationTemplate,
    {}
  )
  const [body, setBody] = useState(slot.body)

  const seg = smsSegments(body)

  return (
    <form action={formAction} className="flex flex-col gap-3 border-b py-5 last:border-b-0">
      <input type="hidden" name="event" value={slot.event} />
      <input type="hidden" name="channel" value="sms" />
      <input type="hidden" name="locale" value={slot.locale} />

      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`tpl-${slot.event}`} className="text-base font-medium">
          {EVENT_LABELS[slot.event] ?? slot.event}
        </Label>
        {slot.templateId ? (
          <Badge variant="outline">Your wording</Badge>
        ) : (
          <Badge variant="secondary">Standard wording</Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {(VARIABLES[slot.event] ?? []).map((name) => (
          <button
            key={name}
            type="button"
            className="rounded-3xl border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            onClick={() => setBody((current) => `${current}{{${name}}}`)}
          >
            {`{{${name}}}`}
          </button>
        ))}
      </div>

      <Textarea
        id={`tpl-${slot.event}`}
        name="body"
        rows={3}
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <FieldError messages={state.fieldErrors?.body} />

      <div className="rounded-md bg-muted/50 p-3 text-sm">
        <div className="text-xs font-medium text-muted-foreground">
          {slot.event.startsWith('visitor_') ? 'A visitor would read' : 'A member would read'}
        </div>
        <div className="mt-1">{preview(body)}</div>
        <div className="mt-2 text-xs text-muted-foreground">
          {body.length} characters, {seg.count} SMS
          {seg.unicode
            ? ` (Nepali text sends as Unicode, so a message is ${seg.perSegment} characters and costs more)`
            : ''}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? 'Saving...' : 'Save wording'}
        </Button>
        {slot.templateId ? (
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            formAction={resetAction}
            name="templateId"
            value={slot.templateId}
          >
            Use the standard wording
          </Button>
        ) : null}
      </div>

      <AuthFormMessage
        error={state.error ?? resetState.error}
        notice={state.success ?? resetState.success}
      />
    </form>
  )
}

export function TemplateEditor({ slots }: { slots: TemplateSlot[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What the message says</CardTitle>
        <CardDescription>
          Editing this changes messages queued from now on. Anything already in
          the log keeps the words it was sent with.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        {slots.map((slot) => (
          <TemplateCard key={slot.event} slot={slot} />
        ))}
      </CardContent>
    </Card>
  )
}
