/**
 * The words the console uses for a notification's status, reason and channel.
 *
 * They live here rather than in the filter component because both a Server
 * Component and a Client Component need them, and a plain constant exported
 * from a `'use client'` module does not survive that crossing: the server sees
 * the client reference rather than the object, and every lookup comes back
 * undefined. That is what left the summary chips reading ": 2" with no word in
 * front of the number.
 */
export const NOTIFICATION_STATUSES = {
  all: 'Every message',
  queued: 'Waiting to go',
  sending: 'Going out now',
  sent: 'Delivered to the gateway',
  failed: 'Failed',
  skipped: 'Not sent',
  cancelled: 'Cancelled',
} as const

/** The same statuses in the short form a badge or a chip has room for. */
export const NOTIFICATION_STATUS_SHORT = {
  queued: 'Waiting',
  sending: 'Going out',
  sent: 'Delivered',
  failed: 'Failed',
  skipped: 'Not sent',
  cancelled: 'Cancelled',
} as const

export const NOTIFICATION_EVENTS = {
  all: 'Every reason',
  renewal_reminder: 'Renewal reminder',
  dues_reminder: 'Dues reminder',
  birthday_greeting: 'Birthday greeting',
  staff_invite: 'Staff invitation',
  test_message: 'Test message',
  custom_message: 'Sent by hand',
  visitor_welcome: 'Visitor welcome',
  visitor_follow_up: 'Visitor follow-up',
} as const

export const NOTIFICATION_CHANNELS = {
  all: 'Every channel',
  sms: 'SMS',
  viber: 'Viber',
  email: 'Email',
} as const
