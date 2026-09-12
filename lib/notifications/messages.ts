import type { NotificationEvent } from '@/lib/db/notifications'

/**
 * A Devanagari SMS is UCS-2, so a segment is 70 characters rather than 160 and
 * bills two to three times an English one. Segments, not characters, are what
 * turn into money, so that is what every screen that shows a message counts.
 *
 * Lifted out of the template editor once the member screen needed the same
 * arithmetic: two copies of this would have disagreed the first time one of
 * them was corrected.
 */
export function smsSegments(body: string) {
  const unicode = Array.from(body).some((character) => character.charCodeAt(0) > 127)
  const perSegment = unicode ? 70 : 160
  return { unicode, count: Math.max(1, Math.ceil(body.length / perSegment)), perSegment }
}

/**
 * What the desk may send by hand. `staff_invite` and `test_message` are not
 * here and the database refuses them too: one is not addressed to a member and
 * the other is an owner's gateway check.
 */
export const MANUAL_EVENTS = [
  'dues_reminder',
  'renewal_reminder',
  'birthday_greeting',
  'custom_message',
] as const satisfies readonly NotificationEvent[]

export type ManualEvent = (typeof MANUAL_EVENTS)[number]

export const MANUAL_EVENT_LABELS: Record<ManualEvent, string> = {
  dues_reminder: 'Dues reminder',
  renewal_reminder: 'Renewal reminder',
  birthday_greeting: 'Birthday greeting',
  custom_message: 'Something else',
}

/**
 * What the desk may send to a walk-in. Narrower than the member list on
 * purpose: the product holds no membership and no balance for a visitor, so a
 * renewal or a dues reminder has nothing to put in the sentence, and
 * `send_visitor_notification` refuses both.
 */
export const VISITOR_EVENTS = [
  'visitor_welcome',
  'visitor_follow_up',
  'custom_message',
] as const satisfies readonly NotificationEvent[]

export type VisitorEvent = (typeof VISITOR_EVENTS)[number]

export const VISITOR_EVENT_LABELS: Record<VisitorEvent, string> = {
  visitor_welcome: 'Welcome / thanks for visiting',
  visitor_follow_up: 'Follow-up',
  custom_message: 'Something else',
}
