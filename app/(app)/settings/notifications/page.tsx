import Link from 'next/link'

import { ProviderForm } from '@/components/notifications/provider-form'
import { RulesForm } from '@/components/notifications/rules-form'
import {
  TemplateEditor,
  type TemplateSlot,
} from '@/components/notifications/template-editor'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { requireRole } from '@/lib/auth'
import {
  listNotificationProviders,
  listNotificationRules,
  listNotificationTemplates,
  notificationHasCredential,
  previewNotificationTemplate,
  type NotificationChannel,
  type NotificationEvent,
} from '@/lib/db/notifications'

const CHANNELS: NotificationChannel[] = ['sms', 'viber', 'email']
const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  sms: 'SMS',
  viber: 'Viber',
  email: 'Email',
}
const EDITABLE_EVENTS: NotificationEvent[] = [
  'renewal_reminder',
  'dues_reminder',
  'birthday_greeting',
  'visitor_welcome',
  'visitor_follow_up',
]

export default async function NotificationSettingsPage() {
  const staff = await requireRole('owner')

  const [providers, rules, templates] = await Promise.all([
    listNotificationProviders(),
    listNotificationRules(),
    listNotificationTemplates(),
  ])

  // The credential flags and the template previews both depend on the first
  // wave but not on each other, so they go out together rather than one after
  // the other.
  const [tokenFlags, slots] = await Promise.all([
    // A boolean per gateway, never the token. Reading one back is impossible by
    // design -- notification_credential is callable by no client role at all.
    Promise.all(
      providers.map(
        async (provider) =>
          [provider.id, await notificationHasCredential(provider.id)] as const
      )
    ),
    // The wording shown is whatever a message would actually use: the gym's own
    // row if it has one, and the built-in otherwise. Resolving it through the
    // database rather than duplicating the defaults here is what stops the
    // preview and the send from drifting apart.
    Promise.all(
      EDITABLE_EVENTS.map(async (event): Promise<TemplateSlot> => {
        const own = templates.find(
          (template) =>
            template.event === event && template.channel === 'sms' && template.is_active
        )
        const resolved = await previewNotificationTemplate(
          staff.orgId,
          event,
          'sms',
          own?.locale ?? 'en'
        )
        return {
          event,
          templateId: own?.id ?? null,
          body: resolved?.body ?? '',
          locale: own?.locale ?? 'en',
        }
      })
    ),
  ])
  const hasToken = Object.fromEntries(tokenFlags)

  // The active one wins. Only active rows are unique per channel, so a channel
  // can hold a paused row alongside a live one, and editing the paused one while
  // the live one keeps sending is the wrong surprise.
  const byChannel = Object.fromEntries(
    CHANNELS.map((channel) => {
      const forChannel = providers.filter((row) => row.channel === channel)
      return [channel, forChannel.find((row) => row.is_active) ?? forChannel[0] ?? null]
    })
  ) as Record<NotificationChannel, (typeof providers)[number] | null>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Which gateway carries your messages, when reminders go out, and what
          they say.{' '}
          <Link href="/notifications" className="underline underline-offset-4">
            See what has been sent
          </Link>
          .
        </p>
      </div>

      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Every gym uses its own SMS account, so the credits and the sender ID are
        yours. Tokens are stored encrypted and cannot be read back from this
        screen, only replaced or cleared.
      </div>

      <Tabs defaultValue="sms" className="gap-4">
        {/* The state of all three channels is on the tabs themselves. A gym that
            has SMS working and email half-configured should not have to click
            twice to find that out. */}
        <TabsList>
          {CHANNELS.map((channel) => (
            <TabsTrigger key={channel} value={channel} className="gap-2">
              <span
                aria-hidden
                className={
                  'size-1.5 rounded-full ' +
                  (byChannel[channel]?.is_active
                    ? 'bg-emerald-500'
                    : byChannel[channel]
                      ? 'bg-amber-500'
                      : 'bg-muted-foreground/40')
                }
              />
              {CHANNEL_LABELS[channel]}
              <span className="text-xs text-muted-foreground">
                {byChannel[channel]?.is_active
                  ? 'Connected'
                  : byChannel[channel]
                    ? 'Paused'
                    : 'Not set up'}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        {CHANNELS.map((channel) => {
          const provider = byChannel[channel] ?? null
          return (
            <TabsContent key={channel} value={channel}>
              <ProviderForm
                channel={channel}
                provider={provider}
                hasToken={provider ? (hasToken[provider.id] ?? false) : false}
              />
            </TabsContent>
          )
        })}
      </Tabs>

      <RulesForm rules={rules} />

      <TemplateEditor slots={slots} />
    </div>
  )
}
