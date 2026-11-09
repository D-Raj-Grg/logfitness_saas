import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

export type AccessTone = 'ok' | 'warn' | 'bad' | 'idle'

const DOT: Record<AccessTone, string> = {
  ok: 'bg-primary',
  warn: 'bg-amber-500',
  bad: 'bg-destructive',
  idle: 'bg-muted-foreground/40',
}

/**
 * One line of the "App & door access" card on the member profile: what the
 * thing is, where it stands (a dot plus a sentence, so colour is never the only
 * signal), and the actions that change it. The three rows used to be three
 * separate bordered boxes of three different heights; as rows of one card they
 * line up and read as one group.
 */
export function AccessRow({
  icon: Icon,
  title,
  tone,
  status,
  note,
  children,
}: {
  icon: LucideIcon
  title: string
  tone: AccessTone
  status: React.ReactNode
  note?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 py-4 first:pt-0 last:pb-0">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Icon className="size-4" />
      </span>

      <div className="flex min-w-48 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="flex items-start gap-2 text-sm break-words text-muted-foreground">
          <span
            aria-hidden
            className={cn('mt-[0.45rem] size-1.5 shrink-0 rounded-full', DOT[tone])}
          />
          <span className="min-w-0">{status}</span>
        </span>
        {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
      </div>

      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  )
}
