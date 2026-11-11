import { z } from 'zod'

import { CARD_NO_MAX, CARD_NO_MIN } from '@/lib/cards/card-no'

const fraction = z.number().finite().min(0).max(1)
const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'Pick a colour')

/** Mirrors parsePlacement() and public.card_placement_is_valid(). */
export const cardPlacementSchema = z.object({
  code: z.object({ x: fraction, y: fraction, w: fraction, h: fraction }),
  qr: z.object({ x: fraction, y: fraction, s: fraction }),
  codeColor: hex,
  qrColor: hex,
  codeScale: z.number().finite().min(0.3).max(1),
  qrInset: z.number().finite().min(0).max(0.15),
})

/** Mirrors the database rule: 1 to 80 characters once trimmed. */
export const cardDesignNameSchema = z
  .string()
  .trim()
  .min(1, 'Give the design a name')
  .max(80, 'Keep the name to 80 characters')

/** "NO.", "No", "" -- at most 8 characters, printed before the number. */
export const labelPrefixSchema = z.string().max(8, 'Keep the prefix to 8 characters')

export const saveCardDesignSchema = z.object({
  id: z.uuid().nullable(),
  name: cardDesignNameSchema,
  /** Storage object key in card-templates: <org_id>/<random>.<ext>. */
  imagePath: z.string().min(1, 'Upload the template first').max(400),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  placement: cardPlacementSchema,
  labelPrefix: labelPrefixSchema,
})

export type SaveCardDesignInput = z.infer<typeof saveCardDesignSchema>

export const deleteCardDesignSchema = z.object({ id: z.uuid() })

/** "Download again" for one past run. */
export const batchPrintSchema = z.object({ batchId: z.uuid() })

export const MAX_CARDS_PER_RUN = 500

/** A print run: 1..9999, low to high, at most 500 cards. */
export const cardRangeSchema = z
  .object({
    from: z.number().int().min(CARD_NO_MIN).max(CARD_NO_MAX),
    to: z.number().int().min(CARD_NO_MIN).max(CARD_NO_MAX),
    designId: z.uuid().nullable(),
  })
  .refine((r) => r.from <= r.to, { message: 'From must not be after To', path: ['to'] })
  .refine((r) => r.to - r.from < MAX_CARDS_PER_RUN, {
    message: `Number at most ${MAX_CARDS_PER_RUN} cards at a time`,
    path: ['to'],
  })

export type CardRangeInput = z.infer<typeof cardRangeSchema>
