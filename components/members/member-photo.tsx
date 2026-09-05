import { cn } from '@/lib/utils'

/**
 * The photos bucket is private, so `url` is a short-lived signed URL rendered by
 * the server. next/image cannot serve it -- the host is not in the configured
 * image domains and the signature would be stripped -- so this is a plain img.
 */
export function MemberPhoto({
  url,
  name,
  className,
}: {
  url: string | null
  name: string
  className?: string
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  if (!url) {
    return (
      <span
        aria-hidden
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground',
          className
        )}
      >
        {initials || '?'}
      </span>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
    <img
      src={url}
      alt={`Photo of ${name}`}
      className={cn('shrink-0 rounded-full border object-cover', className)}
    />
  )
}
