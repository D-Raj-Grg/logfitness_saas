import { z } from 'zod'

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : null))

/**
 * The gym's own details, as they print on an invoice.
 *
 * Phone is plain text, not the member phoneSchema: a gym's number is a landline
 * with an extension as often as it is a mobile.
 *
 * currency and timezone are deliberately absent. Changing either retroactively
 * reinterprets every amount and timestamp already stored, so it is not a form
 * field.
 */
export const orgLetterheadSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long'),
  legalName: optionalText(160),
  address: optionalText(500),
  phone: optionalText(32),
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((value) => (value ? value.toLowerCase() : null))
    .refine((value) => value === null || value.includes('@'), 'Enter a valid email'),
  panNo: optionalText(32),
  taxNote: optionalText(200),
  invoiceTerms: optionalText(2000),
  /**
   * Rupees in, paisa out. This is a list price, never charged on its own: it
   * is the amount a printed document strikes out when a plan or a renewal
   * waives the joining fee.
   */
  standardSignupFeePaisa: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value.replace(/,/g, '') : '0'))
    .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), 'Enter an amount in rupees')
    .transform((value) => Math.round(Number(value) * 100))
    .refine((value) => value <= 100_000_00, 'That fee looks too large'),
})

export type OrgLetterheadInput = z.infer<typeof orgLetterheadSchema>

/**
 * The owner-editable keys of orgs.settings. Bounds mirror the set_org_setting
 * RPC, which is the real gate.
 */
export const MAX_CANCELLATION_WINDOW_MINUTES = 10080

export const orgPreferencesSchema = z.object({
  classCancellationWindowMinutes: z
    .string()
    .trim()
    .refine((value) => /^\d+$/.test(value), 'Enter a whole number of minutes')
    .transform(Number)
    .refine(
      (value) => value <= MAX_CANCELLATION_WINDOW_MINUTES,
      'At most 10080 minutes (7 days)'
    ),
  notificationLocale: z.enum(['en', 'ne'], 'Choose a language'),
})

export type OrgPreferencesInput = z.infer<typeof orgPreferencesSchema>
