import { cn } from '@/lib/utils'

export function AuthFormMessage({
  error,
  notice,
}: {
  error?: string
  notice?: string
}) {
  const message = error ?? notice
  if (!message) return null

  return (
    <p
      role="status"
      className={cn(
        'rounded-md border px-3 py-2 text-sm',
        error
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-border bg-background text-muted-foreground'
      )}
    >
      {message}
    </p>
  )
}

export function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null
  return <p className="text-sm text-destructive">{messages[0]}</p>
}
