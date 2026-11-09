'use client'

import { useMemo, useRef, useState } from 'react'

import { clamp, type CardBox, type CardPlacement } from '@/lib/cards/card-design'
import { qrMatrix, qrRuns } from '@/lib/cards/card-qr'
import { cn } from '@/lib/utils'

type Drag = {
  box: CardBox
  mode: 'move' | 'resize'
  startX: number
  startY: number
  from: CardPlacement
}

const STEP = 0.002
const BIG_STEP = 0.01

/**
 * The card picture with the two boxes laid over it. Drag a box to move it,
 * drag its corner to resize, or focus it and use the arrow keys (Shift =
 * resize, Alt = bigger steps). Every figure is a fraction of the picture, so
 * what is placed here is exactly what the PDF draws.
 */
export function CardEditor({
  imageUrl,
  imageW,
  imageH,
  placement,
  onChange,
  sampleLabel,
  payload,
}: {
  imageUrl: string
  imageW: number
  imageH: number
  placement: CardPlacement
  onChange: (next: CardPlacement) => void
  /** What the number box shows, e.g. "NO. 0004". */
  sampleLabel: string
  /** What the sample QR carries. */
  payload: string
}) {
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [active, setActive] = useState<CardBox | null>(null)

  const ratio = imageH / imageW // picture height as a fraction of its width
  const m = useMemo(() => qrMatrix(payload), [payload])
  const runs = useMemo(() => qrRuns(m), [m])

  function begin(e: React.PointerEvent, box: CardBox, mode: Drag['mode']) {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { box, mode, startX: e.clientX, startY: e.clientY, from: placement }
    setActive(box)
  }

  function move(e: React.PointerEvent) {
    const d = drag.current
    const rect = frame.current?.getBoundingClientRect()
    if (!d || !rect) return
    const dx = (e.clientX - d.startX) / rect.width
    const dy = (e.clientY - d.startY) / rect.height
    onChange(apply(d.from, d.box, d.mode, dx, dy, ratio))
  }

  function end() {
    drag.current = null
  }

  function key(e: React.KeyboardEvent, box: CardBox) {
    const step = e.altKey ? BIG_STEP : STEP
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const delta = arrows[e.key]
    if (!delta) return
    e.preventDefault()
    onChange(apply(placement, box, e.shiftKey ? 'resize' : 'move', delta[0], delta[1], ratio))
  }

  const c = placement.code
  const q = placement.qr
  // 1cqw is 1% of the frame's width, which is the picture's width.
  const codeFont = Math.min(
    c.h * placement.codeScale * ratio * 100,
    // Helvetica Bold is about 0.62em per character; shrink as the PDF does.
    (c.w * 100) / Math.max(1, sampleLabel.length * 0.62)
  )

  return (
    <div
      ref={frame}
      className="relative w-full touch-none select-none overflow-hidden rounded-lg border bg-muted"
      style={{ aspectRatio: `${imageW} / ${imageH}`, containerType: 'inline-size' }}
    >
      {/* A user's own upload, not a static asset: next/image has nothing to optimise. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt="Card template" className="absolute inset-0 size-full" draggable={false} />

      <div
        role="group"
        tabIndex={0}
        aria-label="Card number box. Arrow keys move it, Shift plus arrows resize it."
        className={cn(
          'absolute flex cursor-move items-center justify-center rounded-sm outline-2 outline-dashed outline-primary',
          'focus-visible:outline-solid focus-visible:ring-2 focus-visible:ring-ring',
          active === 'code' && 'outline-solid'
        )}
        style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }}
        onPointerDown={(e) => begin(e, 'code', 'move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(e) => key(e, 'code')}
        onFocus={() => setActive('code')}
      >
        <span
          className="whitespace-nowrap font-bold leading-none"
          style={{
            fontFamily: 'Helvetica, Arial, sans-serif',
            fontSize: `${codeFont}cqw`,
            color: placement.codeColor,
          }}
        >
          {sampleLabel}
        </span>
        <Handle onPointerDown={(e) => begin(e, 'code', 'resize')} onPointerMove={move} onPointerUp={end} />
      </div>

      <div
        role="group"
        tabIndex={0}
        aria-label="QR box. Arrow keys move it, Shift plus arrows resize it."
        className={cn(
          'absolute cursor-move rounded-sm outline-2 outline-dashed outline-primary',
          'focus-visible:outline-solid focus-visible:ring-2 focus-visible:ring-ring',
          active === 'qr' && 'outline-solid'
        )}
        style={{ left: `${q.x * 100}%`, top: `${q.y * 100}%`, width: `${q.s * 100}%`, aspectRatio: '1 / 1' }}
        onPointerDown={(e) => begin(e, 'qr', 'move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(e) => key(e, 'qr')}
        onFocus={() => setActive('qr')}
      >
        <svg
          viewBox={`0 0 ${m.size} ${m.size}`}
          className="absolute"
          style={{
            inset: `${placement.qrInset * 100}%`,
            width: `${(1 - 2 * placement.qrInset) * 100}%`,
            height: `${(1 - 2 * placement.qrInset) * 100}%`,
          }}
          shapeRendering="crispEdges"
          role="img"
          aria-label="Sample QR code"
        >
          <path
            d={runs.map(([r, col, len]) => `M${col} ${r}h${len}v1h${-len}z`).join('')}
            fill={placement.qrColor}
          />
        </svg>
        <Handle onPointerDown={(e) => begin(e, 'qr', 'resize')} onPointerMove={move} onPointerUp={end} />
      </div>
    </div>
  )
}

function Handle(props: React.ComponentProps<'span'>) {
  return (
    <span
      aria-hidden
      className="absolute -right-2 -bottom-2 size-4 cursor-nwse-resize rounded-full border-2 border-background bg-primary"
      {...props}
    />
  )
}

/** The placement after dragging `box` by (dx, dy) picture fractions from where it started. */
function apply(
  from: CardPlacement,
  box: CardBox,
  mode: 'move' | 'resize',
  dx: number,
  dy: number,
  ratio: number
): CardPlacement {
  if (box === 'code') {
    const c = from.code
    if (mode === 'move') {
      return { ...from, code: { ...c, x: clamp(c.x + dx, 0, 1 - c.w), y: clamp(c.y + dy, 0, 1 - c.h) } }
    }
    return {
      ...from,
      code: { ...c, w: clamp(c.w + dx, 0.05, 1 - c.x), h: clamp(c.h + dy, 0.01, 1 - c.y) },
    }
  }
  const q = from.qr
  const maxS = Math.min(1 - q.x, (1 - q.y) / ratio)
  if (mode === 'move') {
    // The square's height as a fraction of the picture height is s / ratio.
    return { ...from, qr: { ...q, x: clamp(q.x + dx, 0, 1 - q.s), y: clamp(q.y + dy, 0, 1 - q.s / ratio) } }
  }
  // Resize follows whichever of dx / dy moved the corner further.
  const grow = Math.abs(dx) >= Math.abs(dy * ratio) ? dx : dy * ratio
  return { ...from, qr: { ...q, s: clamp(q.s + grow, 0.04, maxS) } }
}
