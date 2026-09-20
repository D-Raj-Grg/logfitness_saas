'use client'

import { useActionState } from 'react'

import {
  saveNotificationRule,
  type NotificationSettingsState,
} from '@/app/(app)/settings/notifications/actions'
import { AuthFormMessage } from '@/components/auth/auth-form-message'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { NotificationRuleRow } from '@/lib/db/notifications'

function ruleTitle(rule: NotificationRuleRow) {
  switch (rule.event) {
    case 'renewal_reminder':
      return rule.offset_days === 1
        ? 'The day before a membership ends'
        : `${rule.offset_days} days before a membership ends`
    case 'dues_reminder':
      return rule.offset_days === 0
        ? 'As soon as money is outstanding'
        : `When money has been outstanding for ${rule.offset_days} days`
    case 'birthday_greeting':
      return 'On a member’s birthday'
    case 'visitor_welcome':
      return 'As soon as a visitor is logged at the desk'
    case 'visitor_follow_up':
      return rule.offset_days === 1
        ? 'The day after a visit, if they have not joined'
        : `${rule.offset_days} days after a visit, if they have not joined`
    case 'member_welcome':
      return 'When somebody buys their first membership'
    case 'payment_received':
      return 'Every time money is handed over'
    case 'dues_cleared':
      return 'When a member has nothing left outstanding'
    default:
      return rule.event.replace(/_/g, ' ')
  }
}

function RuleRow({ rule }: { rule: NotificationRuleRow }) {
  const [state, formAction, pending] = useActionState<NotificationSettingsState, FormData>(
    saveNotificationRule,
    {}
  )

  // Two rules have a floor, for the same reason and with different stakes: a
  // gym does not want to spend a message chasing small change, nor receipting
  // it. Everything else ignores the column.
  const hasMinAmount = rule.event === 'dues_reminder' || rule.event === 'payment_received'
  // Only the chase has a cadence. The rest either happen once or happen every
  // time the thing behind them happens.
  const hasRepeat = rule.event === 'dues_reminder'
  // These rules ride the event itself, so there is no hour to pick: they go
  // out within a minute of the walk-in, the sale or the payment. Showing a
  // time here would promise a schedule that does not exist.
  const isImmediate =
    rule.event === 'visitor_welcome' ||
    rule.event === 'member_welcome' ||
    rule.event === 'payment_received' ||
    rule.event === 'dues_cleared'

  return (
    <form action={formAction} className="flex flex-col gap-3 border-b py-4 last:border-b-0">
      <input type="hidden" name="ruleId" value={rule.id} />

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-64 flex-1 items-center gap-2">
          <Checkbox id={`rule-${rule.id}`} name="enabled" defaultChecked={rule.enabled} />
          <Label htmlFor={`rule-${rule.id}`} className="font-normal">
            {ruleTitle(rule)}
          </Label>
        </div>

        {isImmediate ? (
          <>
            <p className="self-center text-sm text-muted-foreground">
              Goes out within a minute
            </p>
            <input type="hidden" name="sendAtLocal" value={rule.send_at_local.slice(0, 5)} />
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`rule-time-${rule.id}`}>Send at</Label>
            <Input
              id={`rule-time-${rule.id}`}
              name="sendAtLocal"
              type="time"
              className="w-32"
              defaultValue={rule.send_at_local.slice(0, 5)}
            />
          </div>
        )}

        {hasMinAmount ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`rule-min-${rule.id}`}>Only over (Rs)</Label>
            <Input
              id={`rule-min-${rule.id}`}
              name="minAmount"
              type="number"
              min={0}
              step="1"
              className="w-32"
              defaultValue={rule.min_amount_paisa / 100}
            />
          </div>
        ) : (
          <input type="hidden" name="minAmount" value={rule.min_amount_paisa / 100} />
        )}

        {hasRepeat ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`rule-repeat-${rule.id}`}>Ask again after (days)</Label>
            <Input
              id={`rule-repeat-${rule.id}`}
              name="repeatAfterDays"
              type="number"
              min={1}
              max={365}
              className="w-36"
              defaultValue={rule.repeat_after_days}
            />
          </div>
        ) : (
          <input type="hidden" name="repeatAfterDays" value={rule.repeat_after_days} />
        )}

        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <AuthFormMessage error={state.error} notice={state.success} />
    </form>
  )
}

export function RulesForm({ rules }: { rules: NotificationRuleRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reminders</CardTitle>
        <CardDescription>
          The reminders are worked out once a night at 02:30, and one set for
          earlier than that goes out the following morning. The rest ride the
          moment they are about -- a visit, a joining, a payment -- and leave
          within a minute. Nothing is sent, and nothing is charged, until a
          gateway is connected above.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        {rules.map((rule) => (
          <RuleRow key={rule.id} rule={rule} />
        ))}
      </CardContent>
    </Card>
  )
}
