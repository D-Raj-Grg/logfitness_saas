import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * The shape every activity panel draws: a handful of rows, each a name on the
 * left and a number or a date on the right, the whole row a link into the
 * record it stands for.
 *
 * It is deliberately not a table. These are six rows read at a glance, and a
 * table's header and column rules cost more than they explain at that size --
 * the tables live on /payments, /members and /visitors, which is where each
 * panel's link goes.
 */
export function ActivityList({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col divide-y text-sm">{children}</ul>
}

export function ActivityRow({
  href,
  title,
  subtitle,
  value,
  note,
  emphasis,
}: {
  href: string
  title: string
  subtitle: ReactNode
  value: string
  note?: ReactNode
  /** Draws the value in the destructive colour: money out, a debt, a deadline. */
  emphasis?: boolean
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-baseline justify-between gap-3 py-2 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        </span>
        <span className="shrink-0 text-right">
          <span
            className={
              emphasis
                ? 'block font-medium tabular-nums text-destructive'
                : 'block font-medium tabular-nums'
            }
          >
            {value}
          </span>
          {note ? <span className="block text-xs text-muted-foreground">{note}</span> : null}
        </span>
      </Link>
    </li>
  )
}

/** Shown in place of the list when the window holds no rows at all. */
export function ActivityEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[120px] items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}
