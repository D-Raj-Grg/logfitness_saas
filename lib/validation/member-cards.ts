import { z } from 'zod'

/**
 * Readers print UIDs as "04:A3:1B:2C", "04 a3 1b 2c" or "04A31B2C". Keep only
 * the hex digits, upper-cased -- the same normalisation normalize_card_uid()
 * applies in Postgres -- and then hold it to the table's own check.
 */
export const cardUidSchema = z
  .string()
  .transform((value) => value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase())
  .pipe(z.string().regex(/^[0-9A-F]{8,20}$/, 'A card UID is 8 to 20 hex characters'))

export const assignMemberCardSchema = z.object({
  memberId: z.uuid(),
  cardUid: cardUidSchema,
  replace: z
    .union([z.literal('true'), z.literal('false'), z.literal('')])
    .optional()
    .transform((value) => value === 'true'),
})

export const revokeMemberCardSchema = z.object({
  memberId: z.uuid(),
  reason: z
    .string()
    .trim()
    .min(1, 'Say why the card is being revoked')
    .max(500, 'Keep the reason to 500 characters'),
})
