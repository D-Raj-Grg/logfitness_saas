'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Input } from '@/components/ui/input'
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_STATUSES,
} from '@/lib/notifications/labels'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const ALL = 'all'

export {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_STATUSES,
} from '@/lib/notifications/labels'

/**
 * Filters live in the URL like every other list here: a delivery log is
 * something you bookmark, or paste into a message asking why a member was not
 * reminded.
 */
export function NotificationFilters({
  status,
  event,
  channel,
  q,
}: {
  status: keyof typeof NOTIFICATION_STATUSES
  event: keyof typeof NOTIFICATION_EVENTS
  channel: keyof typeof NOTIFICATION_CHANNELS
  q: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function navigate(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    // Any change to what is listed starts at page one again.
    params.delete('page')
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '' || value === ALL) params.delete(key)
      else params.set(key, value)
    }
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="notification-status">Show</Label>
        <Select value={status} onValueChange={(value) => navigate({ status: String(value) })}>
          <SelectTrigger id="notification-status" className="w-56">
            <SelectValue>{NOTIFICATION_STATUSES[status]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(NOTIFICATION_STATUSES).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notification-event">Reason</Label>
        <Select value={event} onValueChange={(value) => navigate({ event: String(value) })}>
          <SelectTrigger id="notification-event" className="w-52">
            <SelectValue>{NOTIFICATION_EVENTS[event]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(NOTIFICATION_EVENTS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notification-channel">Channel</Label>
        <Select value={channel} onValueChange={(value) => navigate({ channel: String(value) })}>
          <SelectTrigger id="notification-channel" className="w-44">
            <SelectValue>{NOTIFICATION_CHANNELS[channel]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(NOTIFICATION_CHANNELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notification-q">Search</Label>
        <Input
          id="notification-q"
          defaultValue={q}
          placeholder="Number, address or wording"
          className="w-64"
          onKeyDown={(event_) => {
            if (event_.key === 'Enter') {
              navigate({ q: (event_.target as HTMLInputElement).value.trim() })
            }
          }}
        />
      </div>
    </div>
  )
}
