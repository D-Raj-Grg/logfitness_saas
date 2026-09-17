'use client'

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react'

import {
  createAnnouncement,
  previewAnnouncementAudience,
  type AnnouncementState,
} from '@/app/(app)/announcements/actions'
import { AuthFormMessage, FieldError } from '@/components/auth/auth-form-message'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { smsSegments } from '@/lib/notifications/messages'

export type ComposerBranch = { id: string; name: string }

const AUDIENCES = [
  { value: 'both', label: 'Members and visitors' },
  { value: 'members', label: 'Members only' },
  { value: 'visitors', label: 'Visitors only' },
] as const

type Audience = (typeof AUDIENCES)[number]['value']

const MEMBER_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'frozen', label: 'Frozen' },
] as const

const VISITOR_WINDOWS = [
  { value: 'all', label: 'Every open visitor' },
  { value: '30', label: 'Visited in the last 30 days' },
  { value: '90', label: 'Visited in the last 90 days' },
  { value: '180', label: 'Visited in the last 6 months' },
] as const

export function NewAnnouncementButton({ branches }: { branches: ComposerBranch[] }) {
  const [open, setOpen] = useState(false)
  // Keyed so a second announcement starts blank rather than carrying the
  // first one's wording and filters.
  const [instance, setInstance] = useState(0)

  return (
    <>
      <Button
        onClick={() => {
          setInstance((value) => value + 1)
          setOpen(true)
        }}
      >
        New announcement
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Announce something</DialogTitle>
            <DialogDescription>
              One SMS to everybody you pick. Sent now, or held until a date you set.
            </DialogDescription>
          </DialogHeader>
          {open ? (
            <AnnouncementForm
              key={instance}
              branches={branches}
              onSent={() => setOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

function AnnouncementForm({
  branches,
  onSent,
}: {
  branches: ComposerBranch[]
  onSent: () => void
}) {
  const [state, formAction, pending] = useActionState<AnnouncementState, FormData>(
    createAnnouncement,
    {}
  )

  const [audience, setAudience] = useState<Audience>('both')
  const [branchId, setBranchId] = useState<string>('all')
  const [statuses, setStatuses] = useState<string[]>([])
  const [visitorWindow, setVisitorWindow] = useState<string>('all')
  const [body, setBody] = useState('')
  const [later, setLater] = useState(false)
  const [scheduledLocal, setScheduledLocal] = useState('')

  const [count, setCount] = useState<{
    total: number
    reachable: number
    unusable: number
    members: number
    visitors: number
  } | null>(null)
  const [countError, setCountError] = useState<string | null>(null)
  const [counting, startCounting] = useTransition()

  useEffect(() => {
    if (state.success) onSent()
  }, [state.success, onSent])

  // The recipient count, refetched whenever a filter moves. It is the same
  // function the send uses to build the audience, so the number above the
  // button is the number of messages that will be written.
  useEffect(() => {
    let current = true

    startCounting(async () => {
      const result = await previewAnnouncementAudience({
        audience,
        branchId: branchId === 'all' ? null : branchId,
        memberStatuses: audience === 'visitors' ? [] : statuses,
        visitorDays:
          audience === 'members' || visitorWindow === 'all' ? null : Number(visitorWindow),
      })
      if (!current) return

      if (result.error) {
        setCountError(result.error)
        setCount(null)
        return
      }
      setCountError(null)
      setCount(result.count ?? null)
    })

    return () => {
      current = false
    }
  }, [audience, branchId, statuses, visitorWindow])

  const segments = smsSegments(body)

  // What the send will cost, in the unit gyms actually buy: a Devanagari
  // message is three segments where an English one is one.
  const messageCount = useMemo(
    () => (count ? count.reachable * segments.count : 0),
    [count, segments.count]
  )

  // A `datetime-local` value has no zone. Sent as-is it would be read as UTC,
  // which in Kathmandu is 5h45m wrong -- so it is turned into a real instant
  // in the browser's zone, which is the one the desk is standing in.
  const scheduledIso = useMemo(() => {
    if (!later || !scheduledLocal) return ''
    const when = new Date(scheduledLocal)
    return Number.isNaN(when.getTime()) ? '' : when.toISOString()
  }, [later, scheduledLocal])

  const nothingToSend = count !== null && count.reachable === 0

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="audience" value={audience} />
      <input type="hidden" name="branchId" value={branchId} />
      <input
        type="hidden"
        name="visitorDays"
        value={audience === 'members' ? 'all' : visitorWindow}
      />
      {audience !== 'visitors'
        ? statuses.map((status) => (
            <input key={status} type="hidden" name="memberStatuses" value={status} />
          ))
        : null}
      <input type="hidden" name="scheduledFor" value={scheduledIso} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="announcement-title">Title</Label>
        <Input
          id="announcement-title"
          name="title"
          maxLength={120}
          placeholder="Closed for Vishwakarma Puja"
          required
        />
        <FieldError messages={state.fieldErrors?.title} />
        <p className="text-xs text-muted-foreground">
          For your own log. It is not part of the SMS.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="announcement-audience">Send to</Label>
          <Select
            value={audience}
            onValueChange={(value) => setAudience(String(value) as Audience)}
          >
            <SelectTrigger id="announcement-audience">
              <SelectValue>
                {AUDIENCES.find((item) => item.value === audience)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {AUDIENCES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError messages={state.fieldErrors?.audience} />
        </div>

        {branches.length > 1 ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="announcement-branch">Branch</Label>
            <Select value={branchId} onValueChange={(value) => setBranchId(String(value))}>
              <SelectTrigger id="announcement-branch">
                <SelectValue>
                  {branchId === 'all'
                    ? 'Every branch'
                    : (branches.find((item) => item.id === branchId)?.name ?? 'Every branch')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every branch</SelectItem>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {audience !== 'visitors' ? (
        <div className="flex flex-col gap-2">
          <Label>Members</Label>
          <div className="flex flex-wrap gap-4">
            {MEMBER_STATUSES.map((status) => (
              <label
                key={status.value}
                className="flex items-center gap-2 text-sm"
                htmlFor={`announcement-status-${status.value}`}
              >
                <Checkbox
                  id={`announcement-status-${status.value}`}
                  checked={statuses.includes(status.value)}
                  onCheckedChange={(checked) =>
                    setStatuses((current) =>
                      checked
                        ? [...current, status.value]
                        : current.filter((item) => item !== status.value)
                    )
                  }
                />
                {status.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            None ticked means everyone who has not left. Members who opted out of
            messages are never included.
          </p>
        </div>
      ) : null}

      {audience !== 'members' ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="announcement-visitors">Visitors</Label>
          <Select
            value={visitorWindow}
            onValueChange={(value) => setVisitorWindow(String(value))}
          >
            <SelectTrigger id="announcement-visitors">
              <SelectValue>
                {VISITOR_WINDOWS.find((item) => item.value === visitorWindow)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {VISITOR_WINDOWS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Walk-ins marked “not joining” are never included, and one who has since
            joined is counted once, as a member.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="announcement-body">Message</Label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {body.length} characters · {segments.count} SMS
            {segments.unicode ? ' (Nepali)' : ''}
          </span>
        </div>
        <Textarea
          id="announcement-body"
          name="body"
          rows={5}
          maxLength={1000}
          value={body}
          onChange={(item) => setBody(item.target.value)}
          placeholder="The gym is closed tomorrow for Vishwakarma Puja. We reopen at 6am on Thursday."
        />
        <FieldError messages={state.fieldErrors?.body} />
        <p className="text-xs text-muted-foreground">
          Sent as written. <code>{'{{name}}'}</code>, <code>{'{{gym_name}}'}</code> and{' '}
          <code>{'{{branch_name}}'}</code> are filled in per person.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm" htmlFor="announcement-later">
          <Checkbox
            id="announcement-later"
            checked={later}
            onCheckedChange={(checked) => setLater(Boolean(checked))}
          />
          Send it later
        </label>
        {later ? (
          <Input
            type="datetime-local"
            value={scheduledLocal}
            onChange={(item) => setScheduledLocal(item.target.value)}
            aria-label="When to send"
          />
        ) : null}
        <FieldError messages={state.fieldErrors?.scheduledFor} />
      </div>

      {/* The number, in the unit the gym pays in. Shown before the button
          rather than after the send, because this is the only moment it can
          still be changed. */}
      <div className="rounded-md border bg-muted/40 p-3 text-sm">
        {counting && !count ? (
          <span className="text-muted-foreground">Counting…</span>
        ) : countError ? (
          <span className="text-destructive">{countError}</span>
        ) : count ? (
          <div className="flex flex-col gap-1">
            <span className="font-medium tabular-nums">
              {count.reachable} {count.reachable === 1 ? 'person' : 'people'} will be
              texted
              {body.length > 0 ? ` · about ${messageCount} SMS credits` : ''}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {count.members} member{count.members === 1 ? '' : 's'} · {count.visitors}{' '}
              visitor{count.visitors === 1 ? '' : 's'}
              {count.unusable > 0
                ? ` · ${count.unusable} with no usable number, logged as not sent`
                : ''}
            </span>
          </div>
        ) : null}
      </div>

      <AuthFormMessage error={state.error ?? undefined} />

      <DialogFooter>
        <Button
          type="submit"
          disabled={
            pending ||
            nothingToSend ||
            body.trim().length === 0 ||
            (later && scheduledIso === '')
          }
        >
          {pending
            ? 'Queueing…'
            : later
              ? 'Schedule it'
              : `Send to ${count?.reachable ?? 0}`}
        </Button>
      </DialogFooter>
    </form>
  )
}
