import Link from 'next/link'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * One headline number in a card. Lifted out of the dashboard because the
 * arrears tab had grown a hand-copied version of the same markup, and two
 * copies of a tile drift in padding and tracking until the tabs no longer look
 * like the same product.
 *
 * `href` is optional: a dashboard tile is a link into the screen that shows
 * that detail, but the drawer sheet's tiles are terminal -- the detail is
 * already on the page under them -- and a card that looks clickable and is not
 * is worse than a plain one. `footer` carries whatever sits below the hint,
 * which on the collection sheet is the comparison with yesterday.
 */
export function StatTile({
  label,
  value,
  href,
  hint,
  footer,
  className,
}: {
  label: string
  value: string
  href?: string
  hint?: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  const card = (
    <Card className={cn('h-full', href && 'transition-colors hover:bg-muted/40')}>
      <CardContent className="flex flex-col gap-1 py-4">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <span className={cn('text-2xl font-semibold tabular-nums', className)}>{value}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
        {footer}
      </CardContent>
    </Card>
  )

  if (!href) return card

  return (
    <Link href={href} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
      {card}
    </Link>
  )
}
