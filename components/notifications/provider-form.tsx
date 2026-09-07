'use client'

import { useActionState, useState } from 'react'

import {
  forgetNotificationToken,
  removeNotificationProvider,
  saveNotificationProvider,
  sendTestNotification,
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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { NotificationChannel, NotificationProviderRow } from '@/lib/db/notifications'

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  sms: 'SMS',
  viber: 'Viber',
  email: 'Email',
}

/** Which gateways make sense on which channel. */
const CHOICES: Record<NotificationChannel, { value: string; label: string; hint: string }[]> = {
  sms: [
    {
      value: 'sparrow_sms',
      label: 'Sparrow SMS',
      hint: 'sparrowsms.com. Needs a token and the sender ID registered on your account.',
    },
    {
      value: 'aakash_sms',
      label: 'Aakash SMS',
      hint: 'aakashsms.com. The sender ID is fixed on the account, so leave it blank.',
    },
    {
      value: 'custom_http',
      label: 'Another gateway',
      hint: 'Any provider with an HTTP API. You supply the address and the parameter names.',
    },
  ],
  viber: [
    {
      value: 'viber_business',
      label: 'Viber Business',
      hint: 'Needs a Public Account auth token from Viber.',
    },
    {
      value: 'custom_http',
      label: 'A Viber reseller',
      hint: 'Most Nepali Viber routes are resold behind an SMS-style HTTP API.',
    },
  ],
  email: [
    { value: 'resend_email', label: 'Resend', hint: 'resend.com. The sender must be a verified address.' },
    { value: 'custom_http', label: 'Another provider', hint: 'Any provider with an HTTP API.' },
  ],
}

const SENDERLESS = new Set(['aakash_sms'])

export function ProviderForm({
  channel,
  provider,
  hasToken,
}: {
  channel: NotificationChannel
  provider: NotificationProviderRow | null
  /** Whether a token is stored. Never the token: it cannot be read back. */
  hasToken: boolean
}) {
  const [state, formAction, pending] = useActionState<NotificationSettingsState, FormData>(
    saveNotificationProvider,
    {}
  )
  const [forgetState, forgetAction] = useActionState<NotificationSettingsState, FormData>(
    forgetNotificationToken,
    {}
  )
  const [removeState, removeAction] = useActionState<NotificationSettingsState, FormData>(
    removeNotificationProvider,
    {}
  )
  const [testState, testAction, testing] = useActionState<NotificationSettingsState, FormData>(
    sendTestNotification,
    {}
  )

  const [kind, setKind] = useState<string>(provider?.provider ?? CHOICES[channel][0].value)
  const choice = CHOICES[channel].find((option) => option.value === kind) ?? CHOICES[channel][0]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {CHANNEL_LABELS[channel]}
          {provider?.is_active ? <Badge variant="secondary">Connected</Badge> : null}
          {provider && !provider.is_active ? <Badge variant="outline">Paused</Badge> : null}
        </CardTitle>
        <CardDescription>{choice.hint}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <AuthFormMessage
          error={state.error ?? forgetState.error ?? removeState.error}
          notice={state.success ?? forgetState.success ?? removeState.success}
        />

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="channel" value={channel} />
          <input type="hidden" name="providerId" value={provider?.id ?? ''} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${channel}-provider`}>Gateway</Label>
              <Select name="provider" value={kind} onValueChange={(value) => setKind(String(value))}>
                <SelectTrigger id={`${channel}-provider`}>
                  <SelectValue>{choice.label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CHOICES[channel].map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError messages={state.fieldErrors?.provider} />
            </div>

            {SENDERLESS.has(kind) ? null : (
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${channel}-sender`}>
                  {channel === 'email' ? 'From address' : 'Sender ID'}
                </Label>
                <Input
                  id={`${channel}-sender`}
                  name="senderId"
                  defaultValue={provider?.sender_id ?? ''}
                  placeholder={channel === 'email' ? 'desk@yourgym.com' : 'YOURGYM'}
                />
                <FieldError messages={state.fieldErrors?.senderId} />
              </div>
            )}
          </div>

          {kind === 'custom_http' ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${channel}-endpoint`}>Address</Label>
                <Input
                  id={`${channel}-endpoint`}
                  name="endpointUrl"
                  defaultValue={provider?.endpoint_url ?? ''}
                  placeholder="https://gateway.example.com/send"
                />
                <FieldError messages={state.fieldErrors?.endpointUrl} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${channel}-config`}>Request</Label>
                <Textarea
                  id={`${channel}-config`}
                  name="configJson"
                  rows={5}
                  className="font-mono text-xs"
                  defaultValue={
                    provider?.config ? JSON.stringify(provider.config, null, 2) : ''
                  }
                  placeholder={
                    '{"method":"GET","params":{"token":"{{token}}","to":"{{to}}","text":"{{text}}"}}'
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Use <code>{'{{token}}'}</code>, <code>{'{{to}}'}</code>,{' '}
                  <code>{'{{text}}'}</code> and <code>{'{{sender}}'}</code> where your
                  gateway wants them.
                </p>
                <FieldError messages={state.fieldErrors?.configJson} />
              </div>
            </>
          ) : (
            <input type="hidden" name="endpointUrl" value={provider?.endpoint_url ?? ''} />
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${channel}-token`}>API token</Label>
            <Input
              id={`${channel}-token`}
              name="apiToken"
              type="password"
              autoComplete="off"
              placeholder={hasToken ? 'A token is saved — type a new one to replace it' : 'Paste the token from your gateway account'}
            />
            <p className="text-xs text-muted-foreground">
              Stored encrypted. It cannot be read back here, only replaced or cleared.
            </p>
            <FieldError messages={state.fieldErrors?.apiToken} />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id={`${channel}-active`} name="isActive" defaultChecked={provider?.is_active ?? true} />
            <Label htmlFor={`${channel}-active`} className="font-normal">
              Send on this channel
            </Label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : provider ? 'Save gateway' : 'Connect gateway'}
            </Button>
          </div>
        </form>

        {provider ? (
          <div className="flex flex-col gap-4 border-t pt-4">
            <form action={testAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="channel" value={channel} />
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${channel}-test`}>Send a test to</Label>
                <Input
                  id={`${channel}-test`}
                  name="to"
                  className="w-64"
                  placeholder={channel === 'email' ? 'you@yourgym.com' : '98XXXXXXXX'}
                />
              </div>
              <Button type="submit" variant="outline" disabled={testing}>
                {testing ? 'Queuing…' : 'Send test'}
              </Button>
            </form>
            <AuthFormMessage error={testState.error} notice={testState.success} />

            <div className="flex flex-wrap gap-2">
              {hasToken ? (
                <form action={forgetAction}>
                  <input type="hidden" name="providerId" value={provider.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    Clear the token
                  </Button>
                </form>
              ) : null}
              <form action={removeAction}>
                <input type="hidden" name="providerId" value={provider.id} />
                <Button type="submit" variant="ghost" size="sm">
                  Remove this gateway
                </Button>
              </form>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
