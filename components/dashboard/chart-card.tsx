import Link from 'next/link'
import type { ReactNode } from 'react'

import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'

/**
 * The shell every dashboard panel shares: a title, one line saying what the
 * shape means, and a link into the report that holds the detail. The chart is
 * a summary -- the link is how someone acts on what they just noticed.
 */
export function ChartCard({
  title,
  description,
  href,
  linkLabel,
  children,
}: {
  title: string
  description: string
  href: string
  linkLabel: string
  children: ReactNode
}) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-3 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="mt-0.5">{description}</CardDescription>
          </div>
          <Link
            href={href}
            className="shrink-0 rounded-md text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {linkLabel}
          </Link>
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

/** Shown in place of a plot when the window genuinely holds no rows. */
export function ChartEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[150px] items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}
