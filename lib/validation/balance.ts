import { z } from 'zod'

import { CARD_TOKEN_RE } from '@/lib/cards/card-token'

/**
 * Input to the public balance page. Nobody is signed in, so these only check
 * shape: the RPCs resolve the org by slug and answer org_not_found themselves.
 * The card is named by the random token in its QR -- a printed number is no
 * key -- and the RPC looks that token up, scoped to the org.
 */

export const ORG_SLUG_RE = /^[a-z0-9-]{1,60}$/

export const orgSlugSchema = z
  .string()
  .trim()
  .regex(ORG_SLUG_RE, 'That gym code does not look right')

/** "0004_k3x9q2mf": the link token printed in the card's QR. */
export const cardTokenSchema = z
  .string()
  .trim()
  .regex(CARD_TOKEN_RE, 'This card link does not look right')

export const balanceLookupSchema = z.object({
  org: orgSlugSchema,
  token: cardTokenSchema,
})

export const renewalRequestSchema = z.object({
  org: orgSlugSchema,
  token: cardTokenSchema,
  phone: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ?? '').replace(/[^0-9+]/g, ''))
    .refine((value) => value.length <= 20, 'That phone number is too long')
    .transform((value) => (value ? value : null)),
  note: z
    .string()
    .trim()
    .max(500, 'Keep the note under 500 characters')
    .optional()
    .transform((value) => (value ? value : null)),
  /** Honeypot. Real visitors never see the field; anything in it is a bot. */
  website: z.string().max(0, 'Something went wrong').optional(),
})

export type RenewalRequestInput = z.infer<typeof renewalRequestSchema>
