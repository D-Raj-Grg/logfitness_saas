import { z } from 'zod'

import { parseCardNo } from '@/lib/cards/card-no'

/**
 * Input to the public balance page. Nobody is signed in, so these only check
 * shape: the RPCs resolve the org by slug and answer org_not_found themselves.
 * Bounds mirror public_renewal_request, which is the real gate.
 */

export const ORG_SLUG_RE = /^[a-z0-9-]{1,60}$/

export const orgSlugSchema = z
  .string()
  .trim()
  .regex(ORG_SLUG_RE, 'That gym code does not look right')

/** "4", "04", "0004", "NO. 0004" -> 4. */
export const cardNoSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const n = parseCardNo(value)
    if (n === null) {
      ctx.addIssue({ code: 'custom', message: 'Enter the card number printed on your card (1–9999)' })
      return z.NEVER
    }
    return n
  })

export const balanceLookupSchema = z.object({
  org: orgSlugSchema,
  cardNo: cardNoSchema,
})

export const renewalRequestSchema = z.object({
  org: orgSlugSchema,
  cardNo: cardNoSchema,
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
