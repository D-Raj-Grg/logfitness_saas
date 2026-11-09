import { z } from 'zod'

import { CARD_NO_MAX, CARD_NO_MIN, parseCardNo } from '@/lib/cards/card-no'
import { cardUidSchema } from '@/lib/validation/member-cards'
import { pageSchema } from '@/lib/validation/pagination'

const CARD_NO_MESSAGE = 'Enter the number printed on the card (1–9999)'

/**
 * "4", "04", "0004" and "NO. 0004" are all the same printed card. The form
 * takes text; this hands the database the integer it stores.
 */
export const cardNoSchema = z
  .string()
  .transform((value, ctx) => {
    const n = parseCardNo(value)
    if (n === null) {
      ctx.addIssue({ code: 'custom', message: CARD_NO_MESSAGE })
      return z.NEVER
    }
    return n
  })

const rangeBound = z.coerce.number().int(CARD_NO_MESSAGE).min(CARD_NO_MIN, CARD_NO_MESSAGE).max(CARD_NO_MAX, CARD_NO_MESSAGE)

export const MAX_RANGE_SIZE = 500

export const createRangeSchema = z
  .object({
    from: rangeBound,
    to: rangeBound,
  })
  .superRefine((value, ctx) => {
    if (value.from > value.to) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'To must be the same as From or higher' })
    } else if (value.to - value.from + 1 > MAX_RANGE_SIZE) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `Number at most ${MAX_RANGE_SIZE} cards at a time`,
      })
    }
  })

export const linkUidSchema = z.object({
  cardNo: cardNoSchema,
  cardUid: cardUidSchema,
})

const replaceFlag = z
  .union([z.literal('true'), z.literal('false'), z.literal('')])
  .optional()
  .transform((value) => value === 'true')

/** Blank text means "not given" for the two optional identifiers. */
const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

/**
 * A card goes to a member by its printed number, by its chip UID, or by both
 * (a numbered card whose chip is being linked on the way). At least one is
 * needed; the RPCs decide whether the pair agrees.
 */
export const assignByCardNoSchema = z
  .object({
    memberId: z.uuid(),
    cardNo: z.preprocess(blankToUndefined, cardNoSchema.optional()),
    cardUid: z.preprocess(blankToUndefined, cardUidSchema.optional()),
    replace: replaceFlag,
  })
  .superRefine((value, ctx) => {
    if (value.cardNo === undefined && value.cardUid === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['cardUid'],
        message: 'Type the printed card number, or pick the card from a recent tap.',
      })
    }
  })

export const CARD_STOCK_STATUSES = ['free', 'lost', 'retired'] as const
export type CardStockStatus = (typeof CARD_STOCK_STATUSES)[number]

export const stockStatusSchema = z
  .object({
    cardNo: cardNoSchema,
    status: z.enum(CARD_STOCK_STATUSES),
    reason: z.preprocess(
      blankToUndefined,
      z.string().trim().max(500, 'Keep the reason to 500 characters').optional()
    ),
  })
  .superRefine((value, ctx) => {
    if (value.status !== 'free' && !value.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: `Say why the card is being marked ${value.status}`,
      })
    }
  })

export const CARD_STOCK_FILTERS = [
  'all',
  'assigned',
  'free',
  'lost',
  'retired',
  'unlinked',
] as const
export type CardStockFilter = (typeof CARD_STOCK_FILTERS)[number]

export const cardStockListQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
  status: z.enum(CARD_STOCK_FILTERS).optional().default('all'),
  page: pageSchema,
})

export type CardStockListQuery = z.infer<typeof cardStockListQuerySchema>
