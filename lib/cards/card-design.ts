/**
 * Where the number and the QR go on a card template. Every figure is a
 * fraction of the template picture, so the same placement holds at any
 * resolution -- the editor preview, the PDF and a re-upload of a sharper copy
 * all agree. Mirrored by public.card_placement_is_valid() in the database.
 */
export type CardPlacement = {
  /** The printed-number text box ("NO. 0004"). */
  code: { x: number; y: number; w: number; h: number }
  /** The QR square. `s` is its side as a fraction of the picture **width**. */
  qr: { x: number; y: number; s: number }
  /** Text colour, `#rrggbb`. */
  codeColor: string
  /** QR module colour, `#rrggbb`. */
  qrColor: string
  /** Text height as a fraction of its box height (0.3-1). */
  codeScale: number
  /** White space kept round the QR inside its square, as a fraction of the side. */
  qrInset: number
}

/**
 * A landscape CR80 card: logo across the top, the number bottom-left under
 * it, the QR bottom-right. The gym nudges it from here.
 */
export const DEFAULT_PLACEMENT: CardPlacement = {
  code: { x: 0.06, y: 0.76, w: 0.46, h: 0.14 },
  qr: { x: 0.7, y: 0.52, s: 0.24 },
  codeColor: '#111111',
  qrColor: '#000000',
  codeScale: 0.85,
  qrInset: 0.06,
}

export type CardBox = 'code' | 'qr'

/** Millimetres to PDF points (1 pt = 1/72 in). */
const mm = (n: number) => (n * 72) / 25.4

/** PDF page sizes. CR80 is 85.6 × 54 mm; the bleed variant adds 3 mm a side. */
export const CARD_PAGES = {
  cr80: { label: 'Card 85.6 × 54 mm', widthPt: mm(85.6), heightPt: mm(54) },
  cr80_bleed: { label: 'Card + 3 mm bleed', widthPt: mm(85.6 + 6), heightPt: mm(54 + 6) },
} as const

export type CardPageKey = keyof typeof CARD_PAGES

export const CARD_PAGE_KEYS = Object.keys(CARD_PAGES) as CardPageKey[]

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

const HEX = /^#[0-9a-f]{6}$/i

/** `#rrggbb` -> 0-1 channels, or null when it isn't one. */
export function parseHex(hex: string): [number, number, number] | null {
  if (!HEX.test(hex)) return null
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [
    number,
    number,
    number,
  ]
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A placement from an already-parsed value (jsonb row, form state), or null. */
export function placementFrom(value: unknown): CardPlacement | null {
  if (!value || typeof value !== 'object') return null
  const p = value as Partial<CardPlacement>
  if (
    p.code &&
    p.qr &&
    num(p.code.x) &&
    num(p.code.y) &&
    num(p.code.w) &&
    num(p.code.h) &&
    num(p.qr.x) &&
    num(p.qr.y) &&
    num(p.qr.s) &&
    typeof p.codeColor === 'string' &&
    HEX.test(p.codeColor) &&
    typeof p.qrColor === 'string' &&
    HEX.test(p.qrColor) &&
    num(p.codeScale) &&
    num(p.qrInset)
  ) {
    return {
      code: { x: p.code.x, y: p.code.y, w: p.code.w, h: p.code.h },
      qr: { x: p.qr.x, y: p.qr.y, s: p.qr.s },
      codeColor: p.codeColor,
      qrColor: p.qrColor,
      codeScale: p.codeScale,
      qrInset: p.qrInset,
    }
  }
  return null
}

/** A placement parsed from stored JSON text, or null when it is missing or not shaped like one. */
export function parsePlacement(raw: string | null): CardPlacement | null {
  if (!raw) return null
  try {
    return placementFrom(JSON.parse(raw))
  } catch {
    return null
  }
}

/** A stored placement, or the default when it is missing or not shaped like one. */
export function readPlacement(raw: string | null): CardPlacement {
  return parsePlacement(raw) ?? DEFAULT_PLACEMENT
}

/**
 * A warning when the picture's proportions differ from the page's by more
 * than 2%: the PDF stretches the picture to the page, and past that the
 * stretch shows. Null when they agree.
 */
export function templateAspectWarning(
  widthPx: number,
  heightPx: number,
  page: CardPageKey
): string | null {
  if (!(widthPx > 0) || !(heightPx > 0)) return null
  const p = CARD_PAGES[page]
  const pictureRatio = widthPx / heightPx
  const pageRatio = p.widthPt / p.heightPt
  const deviation = Math.abs(pictureRatio - pageRatio) / pageRatio
  if (deviation <= 0.02) return null
  const pct = Math.round(deviation * 100)
  const shape = pictureRatio > pageRatio ? 'wider' : 'taller'
  return `This picture is about ${pct}% ${shape} than "${p.label}". It will be stretched to fit; crop it to the card's proportions for a clean print.`
}
