'use client'

import { Check, ImageOff, ImageUp } from 'lucide-react'

import type { StudioDesign } from '@/components/cards/card-studio'
import { cn } from '@/lib/utils'

/**
 * Pick a saved design, or start from a new picture. Saved designs show their
 * card as a thumbnail so the right one is recognised at a glance.
 */
export function DesignGallery({
  designs,
  activeId,
  loading,
  onPick,
  onUpload,
}: {
  designs: StudioDesign[]
  activeId: string | null
  loading: boolean
  onPick: (d: StudioDesign) => void
  onUpload: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {designs.length > 0
          ? 'Reuse a saved design, or upload a new card picture.'
          : "Upload a picture of your card (JPEG or PNG, under 5 MB). You'll place the number and QR on it next, and it's saved for next time."}
      </p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {designs.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => onPick(d)}
              disabled={loading || d.url === null}
              aria-pressed={d.id === activeId}
              title={d.url === null ? 'Picture unavailable — reload the page' : undefined}
              className={cn(
                'group flex w-full flex-col gap-2 rounded-lg border p-2 text-left transition-colors',
                'hover:border-primary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60',
                d.id === activeId && 'border-primary bg-primary/5'
              )}
            >
              <span className="relative flex aspect-[1.586/1] items-center justify-center overflow-hidden rounded-md bg-muted">
                {d.url ? (
                  /* A signed storage URL that changes every load: next/image has nothing to cache or optimise. */
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={d.url} alt={`Template of ${d.name}`} className="size-full object-cover" loading="lazy" />
                ) : (
                  <span className="flex flex-col items-center gap-1 p-2 text-center text-xs text-muted-foreground">
                    <ImageOff className="size-5" aria-hidden />
                    Picture unavailable — reload
                  </span>
                )}
              </span>
              <span className="flex min-h-9 items-center gap-1.5 px-1 text-sm font-medium">
                {d.id === activeId ? <Check className="size-4 shrink-0" aria-hidden /> : null}
                <span className="line-clamp-2">{d.name}</span>
              </span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={onUpload}
            disabled={loading}
            className="flex h-full min-h-36 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
          >
            <ImageUp className="size-6" aria-hidden />
            Upload new picture
          </button>
        </li>
      </ul>
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading the design…
        </p>
      ) : null}
    </div>
  )
}
