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
    default:
      return rule.event.replace(/_/g, ' ')
  }
}

function RuleRow({ rule }: { rule: NotificationRuleRow }) {
  const [state, formAction, pending] = useActionState<NotificationSettingsState, FormData>(
    saveNotificationRule,
    {}
  )

  const isDues = rule.event === 'dues_reminder'

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

        {isDues ? (
          <>
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
          </>
        ) : (
          <>
            <input type="hidden" name="minAmount" value={rule.min_amount_paisa / 100} />
            <input type="hidden" name="repeatAfterDays" value={rule.repeat_after_days} />
          </>
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
          Worked out once a night at 02:30. A reminder set for earlier than that
          goes out the following morning. Nothing is sent, and nothing is
          charged, until a gateway is connected above.
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
