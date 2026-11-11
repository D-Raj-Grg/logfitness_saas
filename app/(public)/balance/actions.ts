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
 * "Please renew me", from the public balance page. No session: the card's
 * random link token is the only identity, and public_renewal_request()
 * decides whether it names a member. One pending request per member; a repeat within ten
 * minutes comes back too_soon.
 */
export async function requestRenewal(
  _prevState: RenewalFormState,
  formData: FormData
): Promise<RenewalFormState> {
  const parsed = renewalRequestSchema.safeParse({
    org: formData.get('org'),
    token: formData.get('c'),
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
      parsed.data.token,
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
      return { error: "This card link isn't valid. Scan the QR on your card again." }
    case 'card_unassigned':
      return { error: "This card isn't assigned to a member yet — ask at the front desk." }
  }
}
