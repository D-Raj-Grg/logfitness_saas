import { z } from 'zod'

import { pageSchema, pageSizeSchema } from '@/lib/validation/pagination'

export const notificationChannelSchema = z.enum(['sms', 'viber', 'email'])
export const notificationEventSchema = z.enum([
  'renewal_reminder',
  'dues_reminder',
  'birthday_greeting',
  'staff_invite',
  'test_message',
])

/**
 * `log_only` is deliberately absent. It exists in the database so the pipeline
 * can be exercised with no gateway account, and it is what the sender falls
 * back to; offering it in the settings form would let an owner switch messages
 * off in a way that looks like they are switching them on.
 */
export const notificationProviderSchema = z.enum([
  'sparrow_sms',
  'aakash_sms',
  'viber_business',
  'resend_email',
  'custom_http',
])

export const notificationStatusSchema = z.enum([
  'queued',
  'sending',
  'sent',
  'failed',
  'cancelled',
  'skipped',
])

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null))

/**
 * A gateway carries a token in every request it makes, so its endpoint has to
 * be TLS. The database says the same thing in a CHECK; this is here so the form
 * can refuse it readably instead of surfacing a constraint name.
 */
const httpsUrl = z
  .string()
  .trim()
  .max(400)
  .optional()
  .transform((value) => (value ? value : null))
  .refine(
    (value) => value === null || value.startsWith('https://'),
    'The address must start with https:// -- the gateway token travels in the request'
  )

export const notificationProviderFormSchema = z
  .object({
    providerId: z.union([z.uuid(), z.literal('')]).optional(),
    channel: notificationChannelSchema,
    provider: notificationProviderSchema,
    senderId: optionalText(32),
    endpointUrl: httpsUrl,
    // Blank means "leave the stored token alone". There is no way to read one
    // back, so a form that round-tripped it would have to send a placeholder
    // and then guess whether the owner meant it.
    apiToken: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((value) => (value ? value : null)),
    isActive: z.coerce.boolean().default(true),
    configJson: z
      .string()
      .trim()
      .optional()
      .transform((value) => (value ? value : null)),
  })
  .refine(
    (value) => value.provider !== 'custom_http' || value.endpointUrl !== null,
    { path: ['endpointUrl'], message: 'A custom gateway needs an address to call' }
  )
  .refine(
    (value) => {
      if (!value.configJson) return true
      try {
        const parsed: unknown = JSON.parse(value.configJson)
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      } catch {
        return false
      }
    },
    { path: ['configJson'], message: 'The gateway settings must be a JSON object' }
  )

export const notificationRuleFormSchema = z.object({
  ruleId: z.uuid(),
  enabled: z.coerce.boolean().default(false),
  minAmount: z.coerce.number().min(0).max(10_000_000).catch(0).default(0),
  repeatAfterDays: z.coerce.number().int().min(1).max(365).catch(7).default(7),
  sendAtLocal: z
    .string()
    .trim()
    .regex(/^\d{2}:\d{2}$/, 'Enter the time as HH:MM')
    .default('09:00'),
})

export const notificationTemplateFormSchema = z.object({
  event: notificationEventSchema,
  channel: notificationChannelSchema,
  locale: z.enum(['en', 'ne']).default('en'),
  subject: optionalText(200),
  body: z
    .string()
    .trim()
    .min(1, 'The message cannot be empty')
    .max(1000, 'The message is too long for one send'),
})

export const notificationTestSendSchema = z.object({
  channel: notificationChannelSchema,
  to: z.string().trim().min(3, 'Who should this go to?').max(254),
})

export const notificationIdSchema = z.object({ notificationId: z.uuid() })

/**
 * The delivery log's own query. Every field falls back rather than throwing, so
 * a hand-edited URL never 500s the screen.
 */
export const notificationListQuerySchema = z.object({
  status: z.enum(['all', 'queued', 'sending', 'sent', 'failed', 'cancelled', 'skipped'])
    .catch('all')
    .default('all'),
  event: z.enum(['all', 'renewal_reminder', 'dues_reminder', 'birthday_greeting', 'staff_invite', 'test_message'])
    .catch('all')
    .default('all'),
  channel: z.enum(['all', 'sms', 'viber', 'email']).catch('all').default('all'),
  q: z.string().trim().max(120).optional().default(''),
  page: pageSchema,
  pageSize: pageSizeSchema,
})

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>
export type NotificationProviderInput = z.infer<typeof notificationProviderFormSchema>
export type NotificationTemplateInput = z.infer<typeof notificationTemplateFormSchema>
