'use client'

import { useActionState, useEffect, useRef, useState } from 'react'

import { toast } from 'sonner'

import {
  forgetNotificationToken,
  pollGatewayBalance,
  removeNotificationProvider,
  saveNotificationProvider,
  sendTestNotification,
  startGatewayBalanceCheck,
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
import type {
  GatewayBalanceRoute,
  NotificationChannel,
  NotificationProviderRow,
} from '@/lib/db/notifications'

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
      value: 'smspasal_sms',
      label: 'SMSPasal',
      hint: 'smspasal.com. Needs the API key from Developer API and a sender ID approved on your account.',
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

/** Gateways that publish a credit balance the console can read back. */
const BALANCE_CAPABLE = new Set(['smspasal_sms'])

/**
 * Remaining credits, asked for on demand rather than on every page load: it is
 * a live call to the gateway, and pg_net answers out of band, so the button
 * fires the request and then polls for the reply.
 */
function BalanceCheck({ providerId }: { providerId: string }) {
  const [state, setState] = useState<{
    checking: boolean
    routes: GatewayBalanceRoute[] | null
    error: string | null
    asked: boolean
  }>({ checking: false, routes: null, error: null, asked: false })

  async function check() {
    setState({ checking: true, routes: null, error: null, asked: true })

    const started = await startGatewayBalanceCheck(providerId)
    if (started.error) {
      setState({ checking: false, routes: null, error: started.error, asked: true })
      return
    }

    // Eight tries at 1.5s covers the 15s timeout the request itself carries.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      const result = await pollGatewayBalance(providerId)
      if (!result.pending) {
        setState({
          checking: false,
          routes: result.routes,
          error: result.error,
          asked: true,
        })
        return
      }
    }

    setState({
      checking: false,
      routes: null,
      error: 'The gateway has not answered yet. Try again in a moment.',
      asked: true,
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={check} disabled={state.checking}>
          {state.checking ? 'Checking…' : 'Check balance'}
        </Button>
        {state.routes?.length ? (
          <div className="flex flex-wrap items-center gap-2">
            {state.routes.map((route) => (
              <Badge key={route.ROUTE_ID} variant="secondary">
                {route.ROUTE}: {route.BALANCE} SMS
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      {state.error ? (
        <p className="text-xs text-destructive">{state.error}</p>
      ) : null}
      {state.asked && !state.checking && !state.error && !state.routes?.length ? (
        <p className="text-xs text-muted-foreground">
          The gateway reported no routes on this account.
        </p>
      ) : null}
    </div>
  )
}

/**
 * Announces a server action's result once per result. `useActionState` hands
 * back the same object until the next submit, so the toast is keyed on identity
 * rather than on the text, and a second identical failure still announces
 * itself.
 */
function useOutcomeToast(state: NotificationSettingsState, channel: string) {
  const seen = useRef<NotificationSettingsState | null>(null)

  useEffect(() => {
    if (seen.current === state) return
    seen.current = state
    if (state.error) toast.error(`${channel}: ${state.error}`)
    else if (state.success) toast.success(`${channel}: ${state.success}`)
  }, [state, channel])
}

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

  // Every one of these forms is a button that fires and then says nothing
  // unless it is told to. A toast says it out loud; the banner keeps it on
  // screen for as long as the owner wants to read it.
  useOutcomeToast(state, CHANNEL_LABELS[channel])
  useOutcomeToast(forgetState, CHANNEL_LABELS[channel])
  useOutcomeToast(removeState, CHANNEL_LABELS[channel])
  useOutcomeToast(testState, CHANNEL_LABELS[channel])

  const [replacingToken, setReplacingToken] = useState(false)
  const [kind, setKind] = useState<string>(provider?.provider ?? CHOICES[channel][0].value)
  const choice = CHOICES[channel].find((option) => option.value === kind) ?? CHOICES[channel][0]

  // `config` is free-form jsonb, so the two SMSPasal ids are read out of it
  // defensively rather than trusted to be strings.
  const stored = (provider?.config ?? {}) as Record<string, unknown>
  const config = {
    campaign: typeof stored.campaign === 'string' ? stored.campaign : '',
    routeid: typeof stored.routeid === 'string' ? stored.routeid : '',
    senderNtc: typeof stored.sender_ntc === 'string' ? stored.sender_ntc : '',
    senderNcell: typeof stored.sender_ncell === 'string' ? stored.sender_ncell : '',
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {CHANNEL_LABELS[channel]}
          {provider?.is_active ? <Badge variant="secondary">Connected</Badge> : null}
          {provider && !provider.is_active ? <Badge variant="outline">Paused</Badge> : null}
          {provider && !hasToken ? (
            <Badge variant="outline" className="border-amber-500/40 text-amber-600">
              No token yet
            </Badge>
          ) : null}
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

          {kind === 'smspasal_sms' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${channel}-campaign`}>
                  Campaign ID <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id={`${channel}-campaign`}
                  name="campaign"
                  defaultValue={config.campaign}
                  placeholder="9768"
                />
                <FieldError messages={state.fieldErrors?.campaign} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${channel}-routeid`}>
                  Route ID <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id={`${channel}-routeid`}
                  name="routeid"
                  defaultValue={config.routeid}
                  placeholder="10259"
                />
                <FieldError messages={state.fieldErrors?.routeid} />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Both are on the Developer API page of your SMSPasal account. Leave
                them blank to use whatever that account already defaults to.
              </p>

              <div className="flex flex-col gap-2">
                <Label htmlFor={`${channel}-sender-ntc`}>
                  NTC sender ID <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id={`${channel}-sender-ntc`}
                  name="senderNtc"
                  defaultValue={config.senderNtc}
                  placeholder="same as above"
                />
                <FieldError messages={state.fieldErrors?.senderNtc} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${channel}-sender-ncell`}>
                  Ncell sender ID <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id={`${channel}-sender-ncell`}
                  name="senderNcell"
                  defaultValue={config.senderNcell}
                  placeholder="same as above"
                />
                <FieldError messages={state.fieldErrors?.senderNcell} />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Operators register sender IDs separately, so a gateway can send
                as one word on NTC (984, 985, 986, 974, 975, 976) and another on
                Ncell (980, 981, 982, 970). Fill these in only if your gateway
                gave you two; blank means every number gets the sender ID above.
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${channel}-token`}>API token</Label>

            {hasToken && !replacingToken ? (
              // A saved token is never echoed back -- nothing can read it, not
              // even this screen. What an empty box cannot say is "there is one
              // and it is in use", so the mask stands in for it.
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex h-9 flex-1 min-w-48 items-center rounded-md border bg-muted/40 px-3 font-mono text-sm tracking-[0.25em] text-muted-foreground">
                  ••••••••••••
                </span>
                <Badge variant="secondary">Saved</Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setReplacingToken(true)}
                >
                  Replace
                </Button>
              </div>
            ) : (
              <Input
                id={`${channel}-token`}
                name="apiToken"
                type="password"
                autoComplete="off"
                autoFocus={replacingToken}
                placeholder={
                  hasToken
                    ? 'Paste the new token, then save'
                    : 'Paste the token from your gateway account'
                }
              />
            )}

            <p className="text-xs text-muted-foreground">
              {hasToken && !replacingToken
                ? 'Stored encrypted. It cannot be read back here, only replaced or cleared.'
                : 'Stored encrypted the moment you save. It cannot be read back afterwards.'}
            </p>
            <FieldError messages={state.fieldErrors?.apiToken} />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id={`${channel}-active`} name="isActive" defaultChecked={provider?.is_active ?? true} />
            <Label htmlFor={`${channel}-active`} className="font-normal">
              Send on this channel
            </Label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : provider ? 'Save gateway' : 'Connect gateway'}
            </Button>
            {state.error ? (
              <span className="text-sm text-destructive">{state.error}</span>
            ) : null}
            {!state.error && state.success ? (
              <span className="text-sm text-emerald-600">{state.success}</span>
            ) : null}
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

            {BALANCE_CAPABLE.has(provider.provider) && hasToken ? (
              <BalanceCheck providerId={provider.id} />
            ) : null}

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
