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

/**
 * What each message is called and when it goes out. The name says WHAT the
 * member receives; the line under it says WHEN. Rules that share an event
 * (the 7-day and 1-day renewal reminders) are told apart by the timing in the
 * name, so no two rows read alike.
 */
function ruleCopy(rule: NotificationRuleRow): { title: string; when: string } {
  const days = rule.offset_days
  switch (rule.event) {
    case 'renewal_reminder':
      return {
        title: days === 1 ? 'Plan ends tomorrow' : `Plan ends in ${days} days`,
        when: 'Reminds the member to renew before their plan runs out.',
      }
    case 'dues_reminder':
      return {
        title: days === 0 ? 'Payment due' : `Payment overdue by ${days} days`,
        when:
          days === 0
            ? 'Asks the member to pay what they owe, starting the day it is owed.'
            : `Asks the member to pay once money has been owed for ${days} days. Repeats until they pay.`,
      }
    case 'payment_received':
      return {
        title: 'Payment receipt',
        when: 'Sent each time a payment is recorded.',
      }
    case 'dues_cleared':
      return {
        title: 'Dues cleared',
        when: 'Sent when a member’s balance reaches zero.',
      }
    case 'member_welcome':
      return {
        title: 'New member welcome',
        when: 'Sent when someone buys their first membership.',
      }
    case 'membership_renewed':
      return {
        title: 'Renewal confirmation',
        when: 'Sent when an existing member buys another plan. Replaces the payment receipt for that sale.',
      }
    case 'birthday_greeting':
      return {
        title: 'Birthday wish',
        when: 'Sent on the member’s birthday.',
      }
    case 'visitor_welcome':
      return {
        title: 'Visitor welcome',
        when: 'Sent when the front desk logs a new visitor.',
      }
    case 'visitor_follow_up':
      return {
        title: days === 1 ? 'Visitor follow-up (1 day after)' : `Visitor follow-up (${days} days after)`,
        when: 'Sent only if the visitor has not joined yet.',
      }
    default:
      return { title: rule.event.replace(/_/g, ' '), when: '' }
  }
}

/** Rules grouped by what they are about, in the order a desk thinks of them. */
const GROUPS: { title: string; description: string; events: string[] }[] = [
  {
    title: 'Plan renewals',
    description: 'Help members renew before their plan ends.',
    events: ['renewal_reminder'],
  },
  {
    title: 'Payments',
    description: 'Chase what is owed, and confirm what was paid.',
    events: ['dues_reminder', 'payment_received', 'dues_cleared'],
  },
  {
    title: 'New and returning members',
    description: 'Greet people when they join, renew or have a birthday.',
    events: ['member_welcome', 'membership_renewed', 'birthday_greeting'],
  },
  {
    title: 'Visitors',
    description: 'Follow up with people who walked in but have not joined.',
    events: ['visitor_welcome', 'visitor_follow_up'],
  },
]

function RuleRow({ rule }: { rule: NotificationRuleRow }) {
  const copy = ruleCopy(rule)
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
    rule.event === 'dues_cleared' ||
    rule.event === 'membership_renewed'

  return (
    <form action={formAction} className="flex flex-col gap-3 py-4">
      <input type="hidden" name="ruleId" value={rule.id} />

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-64 flex-1 items-start gap-3">
          <Checkbox
            id={`rule-${rule.id}`}
            name="enabled"
            defaultChecked={rule.enabled}
            className="mt-0.5"
          />
          <div className="flex flex-col gap-0.5">
            <Label htmlFor={`rule-${rule.id}`} className="text-sm font-medium">
              {copy.title}
            </Label>
            <p className="max-w-prose text-sm text-muted-foreground">{copy.when}</p>
            {isImmediate ? (
              <p className="text-xs text-muted-foreground">Goes out within a minute.</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {isImmediate ? (
            <input type="hidden" name="sendAtLocal" value={rule.send_at_local.slice(0, 5)} />
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`rule-time-${rule.id}`} className="text-xs text-muted-foreground">
                Send at
              </Label>
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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`rule-min-${rule.id}`} className="text-xs text-muted-foreground">
                {rule.event === 'dues_reminder' ? 'Only if owing over (Rs)' : 'Only if over (Rs)'}
              </Label>
              <Input
                id={`rule-min-${rule.id}`}
                name="minAmount"
                type="number"
                min={0}
                step="1"
                className="w-40"
                defaultValue={rule.min_amount_paisa / 100}
              />
            </div>
          ) : (
            <input type="hidden" name="minAmount" value={rule.min_amount_paisa / 100} />
          )}

          {hasRepeat ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`rule-repeat-${rule.id}`} className="text-xs text-muted-foreground">
                Repeat every (days)
              </Label>
              <Input
                id={`rule-repeat-${rule.id}`}
                name="repeatAfterDays"
                type="number"
                min={1}
                max={365}
                className="w-32"
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
      </div>

      <AuthFormMessage error={state.error} notice={state.success} />
    </form>
  )
}

export function RulesForm({ rules }: { rules: NotificationRuleRow[] }) {
  const known = new Set(GROUPS.flatMap((group) => group.events))
  const other = rules.filter((rule) => !known.has(rule.event))

  const sections = [
    ...GROUPS.map((group) => ({
      ...group,
      rules: group.events.flatMap((event) => rules.filter((rule) => rule.event === event)),
    })),
    { title: 'Other', description: '', events: [], rules: other },
  ].filter((section) => section.rules.length > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Automatic messages</CardTitle>
        <CardDescription>
          Choose which messages members and visitors get, and when. Tick a
          message to turn it on, change its settings, then press Save on that
          row. Nothing is sent or charged until a gateway is connected above.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-8">
        {sections.map((section) => (
          <section key={section.title} className="flex flex-col">
            <div className="flex flex-col gap-0.5 border-b pb-2">
              <h3 className="text-sm font-semibold">{section.title}</h3>
              {section.description ? (
                <p className="text-sm text-muted-foreground">{section.description}</p>
              ) : null}
            </div>
            <div className="flex flex-col divide-y">
              {section.rules.map((rule) => (
                <RuleRow key={rule.id} rule={rule} />
              ))}
            </div>
          </section>
        ))}

        <p className="text-sm text-muted-foreground">
          Timing: messages with a “Send at” time are prepared once a night at
          02:30. A time earlier than 02:30 goes out the next morning. All other
          messages go out within a minute of the visit, sale or payment.
        </p>
      </CardContent>
    </Card>
  )
}
