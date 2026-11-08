'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { submitRenewalRequest } from '@/lib/db/public-balance'
import { renewalRequestSchema } from '@/lib/validation/balance'

export type RenewalFormState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[] | undefined>
}

/**
 * "Please renew me", from the public balance page. No session: the card
 * number is the only identity, and public_renewal_request() decides whether
 * it names a member. One pending request per member; a repeat within ten
 * minutes comes back too_soon.
 */
export async function requestRenewal(
  _prevState: RenewalFormState,
  formData: FormData
): Promise<RenewalFormState> {
  const parsed = renewalRequestSchema.safeParse({
    org: formData.get('org'),
    cardNo: formData.get('card_no'),
    phone: formData.get('phone') ?? undefined,
    note: formData.get('note') ?? undefined,
    website: formData.get('website') ?? undefined,
  })

  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors
    // A filled honeypot is a bot; answer as if it worked and do nothing.
    if (fieldErrors.website) return { success: 'Thanks — the front desk will call you.' }
    return { fieldErrors }
  }

  let result
  try {
    result = await submitRenewalRequest(
      parsed.data.org,
      String(parsed.data.cardNo),
      parsed.data.phone,
      parsed.data.note
    )
  } catch (error) {
    console.error('public_renewal_request failed', error)
    return { error: 'Something went wrong. Please ask at the front desk.' }
  }

  switch (result.result) {
    case 'ok':
      revalidatePath('/balance')
      return { success: 'Thanks — the front desk will call you.' }
    case 'too_soon':
      return { success: 'You already asked a few minutes ago — the desk has it.' }
    case 'org_not_found':
      return { error: 'This link is missing a valid gym code.' }
    case 'card_not_found':
      return { error: 'No card with this number.' }
    case 'card_unassigned':
      return { error: "This card isn't assigned to a member yet — ask at the front desk." }
  }
}
