'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import {
  clearNotificationCredential,
  deleteNotificationProvider,
  deleteNotificationTemplate,
  enqueueNotification,
  insertNotificationProvider,
  listNotificationProviders,
  setNotificationCredential,
  updateNotificationProvider,
  updateNotificationRule,
  upsertNotificationTemplate,
} from '@/lib/db/notifications'
import type { Json } from '@/lib/types/database'
import {
  notificationProviderFormSchema,
  notificationRuleFormSchema,
  notificationTemplateFormSchema,
  notificationTestSendSchema,
} from '@/lib/validation/notifications'

export type NotificationSettingsState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[] | undefined>
}

type DbError = { code?: string; message?: string }

function dbErrorMessage(error: unknown) {
  const { code, message } = (error ?? {}) as DbError
  if (code === '23505') {
    return 'There is already a gateway for that channel. Edit it instead of adding a second one.'
  }
  if (code === '23514') {
    return 'The gateway address must be an https:// address.'
  }
  if (code === '42501') return 'Only an owner can change this.'
  if (message) return message
  return 'Something went wrong. Try again.'
}

function providerFormValues(formData: FormData) {
  return {
    providerId: formData.get('providerId'),
    channel: formData.get('channel'),
    provider: formData.get('provider'),
    senderId: formData.get('senderId'),
    endpointUrl: formData.get('endpointUrl'),
    apiToken: formData.get('apiToken'),
    isActive: formData.get('isActive') === 'on',
    configJson: formData.get('configJson'),
  }
}

/**
 * One form for connecting a gateway and for editing one. The token is
 * write-only: a blank field means "leave whatever is stored alone", because
 * there is no way to read a token back to prefill it and a placeholder would
 * only invite someone to save the placeholder.
 */
export async function saveNotificationProvider(
  _prevState: NotificationSettingsState,
  formData: FormData
): Promise<NotificationSettingsState> {
  const staff = await requireRole('owner')

  const parsed = notificationProviderFormSchema.safeParse(providerFormValues(formData))
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const input = parsed.data
  // Already proved to be a JSON object by the schema; the generated column
  // type is Json, so it is cast rather than re-validated here.
  const config = (input.configJson ? JSON.parse(input.configJson) : {}) as Json

  try {
    let providerId = input.providerId || null

    if (providerId) {
      await updateNotificationProvider(providerId, {
        provider: input.provider,
        sender_id: input.senderId,
        endpoint_url: input.endpointUrl,
        config,
        is_active: input.isActive,
      })
    } else {
      const row = await insertNotificationProvider({
        org_id: staff.orgId,
        channel: input.channel,
        provider: input.provider,
        sender_id: input.senderId,
        endpoint_url: input.endpointUrl,
        config,
        is_active: input.isActive,
        created_by: staff.staffId,
      })
      providerId = row.id
    }

    if (input.apiToken) {
      await setNotificationCredential(providerId, input.apiToken)
    }
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/settings/notifications')
  revalidatePath('/notifications')
  return { success: 'Gateway saved.' }
}

export async function removeNotificationProvider(
  _prevState: NotificationSettingsState,
  formData: FormData
): Promise<NotificationSettingsState> {
  await requireRole('owner')

  const parsed = z.object({ providerId: z.uuid() }).safeParse({
    providerId: formData.get('providerId'),
  })
  if (!parsed.success) return { error: 'That gateway does not exist.' }

  try {
    // The token goes with it -- an after-delete trigger drops the vault secret,
    // so removing a gateway does not leave a live credential behind.
    await deleteNotificationProvider(parsed.data.providerId)
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/settings/notifications')
  return { success: 'Gateway removed.' }
}

export async function forgetNotificationToken(
  _prevState: NotificationSettingsState,
  formData: FormData
): Promise<NotificationSettingsState> {
  await requireRole('owner')

  const parsed = z.object({ providerId: z.uuid() }).safeParse({
    providerId: formData.get('providerId'),
  })
  if (!parsed.success) return { error: 'That gateway does not exist.' }

  try {
    await clearNotificationCredential(parsed.data.providerId)
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/settings/notifications')
  return { success: 'Token cleared. Nothing will be sent on that channel until a new one is set.' }
}

export async function saveNotificationRule(
  _prevState: NotificationSettingsState,
  formData: FormData
): Promise<NotificationSettingsState> {
  await requireRole('owner')

  const parsed = notificationRuleFormSchema.safeParse({
    ruleId: formData.get('ruleId'),
    enabled: formData.get('enabled') === 'on',
    minAmount: formData.get('minAmount'),
    repeatAfterDays: formData.get('repeatAfterDays'),
    sendAtLocal: formData.get('sendAtLocal'),
  })
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  try {
    await updateNotificationRule(parsed.data.ruleId, {
      enabled: parsed.data.enabled,
      // Money is integer paisa everywhere below the render boundary.
      min_amount_paisa: Math.round(parsed.data.minAmount * 100),
      repeat_after_days: parsed.data.repeatAfterDays,
      send_at_local: parsed.data.sendAtLocal,
    })
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/settings/notifications')
  return { success: 'Reminder saved.' }
}

export async function saveNotificationTemplate(
  _prevState: NotificationSettingsState,
  formData: FormData
): Promise<NotificationSettingsState> {
  const staff = await requireRole('owner')

  const parsed = notificationTemplateFormSchema.safeParse({
    event: formData.get('event'),
    channel: formData.get('channel'),
    locale: formData.get('locale'),
    subject: formData.get('subject'),
    body: formData.get('body'),
  })
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  try {
    await upsertNotificationTemplate({
      org_id: staff.orgId,
      event: parsed.data.event,
      channel: parsed.data.channel,
      locale: parsed.data.locale,
      subject: parsed.data.subject,
      body: parsed.data.body,
      is_active: true,
      updated_by: staff.staffId,
    })
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/settings/notifications')
  return { success: 'Wording saved. It applies to messages queued from now on.' }
}

/** Drop the gym's own wording so the built-in text takes over again. */
export async function resetNotificationTemplate(
  _prevState: NotificationSettingsState,
  formData: FormData
): Promise<NotificationSettingsState> {
  await requireRole('owner')

  const parsed = z.object({ templateId: z.uuid() }).safeParse({
    templateId: formData.get('templateId'),
  })
  if (!parsed.success) return { error: 'There is nothing to reset.' }

  try {
    await deleteNotificationTemplate(parsed.data.templateId)
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/settings/notifications')
  return { success: 'Reset to the standard wording.' }
}

/**
 * Send one real message to one number the owner chooses. This is the only way
 * to find out whether a token, a sender ID and a route actually work -- every
 * gateway accepts a plausible-looking request and only tells you the truth when
 * a handset lights up.
 */
export async function sendTestNotification(
  _prevState: NotificationSettingsState,
  formData: FormData
): Promise<NotificationSettingsState> {
  const staff = await requireRole('owner')

  const parsed = notificationTestSendSchema.safeParse({
    channel: formData.get('channel'),
    to: formData.get('to'),
  })
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const providers = await listNotificationProviders()
  const gateway = providers.find(
    (provider) => provider.channel === parsed.data.channel && provider.is_active
  )
  if (!gateway) {
    return { error: 'There is no gateway on that channel yet, so nothing would go out.' }
  }

  try {
    await enqueueNotification({
      channel: parsed.data.channel,
      event: 'test_message',
      to: parsed.data.to,
      body: `Test message from ${staff.orgName}. If you are reading it, the gateway works.`,
      staffId: staff.staffId,
    })
  } catch (error) {
    return { error: dbErrorMessage(error) }
  }

  revalidatePath('/notifications')
  return {
    success:
      'Queued. It goes out within a minute — watch the Notifications log for what the gateway said.',
  }
}
