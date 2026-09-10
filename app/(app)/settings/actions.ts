'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import {
  getOrgProfile,
  removeOrgLogo,
  updateOrgProfile,
  uploadOrgLogo,
} from '@/lib/db/orgs'
import { ALLOWED_LOGO_TYPES, MAX_LOGO_BYTES, orgLogoPath } from '@/lib/org-logo'
import { orgLetterheadSchema } from '@/lib/validation/orgs'

export type SettingsFormState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[] | undefined>
}

type DbError = { code?: string; message?: string }

/**
 * A logo is optional, so an empty file input is not an error. Anything present
 * has to pass the same limits the bucket enforces, checked here so a bad file
 * comes back as a field message rather than a storage exception.
 */
type LogoPick = { ok: true; file: File } | { ok: false; error: string }

function readLogo(formData: FormData): LogoPick | null {
  const file = formData.get('logo')
  if (!(file instanceof File) || file.size === 0) return null

  if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
    return { ok: false, error: 'The logo must be a JPEG, PNG, or WebP image.' }
  }
  if (file.size > MAX_LOGO_BYTES) {
    return { ok: false, error: 'The logo must be 2 MB or smaller.' }
  }

  return { ok: true, file }
}

export async function updateOrgLetterhead(
  _prevState: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  // Owner-only for clarity; "owners update their own org" is what enforces it.
  const staff = await requireRole('owner')

  const parsed = orgLetterheadSchema.safeParse({
    name: formData.get('name'),
    legalName: formData.get('legalName'),
    address: formData.get('address'),
    phone: formData.get('phone'),
    email: formData.get('email'),
    panNo: formData.get('panNo'),
    taxNote: formData.get('taxNote'),
    invoiceTerms: formData.get('invoiceTerms'),
    standardSignupFeePaisa: formData.get('standardSignupFee'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const logo = readLogo(formData)
  if (logo && !logo.ok) {
    return { fieldErrors: { logo: [logo.error] } }
  }

  const existing = await getOrgProfile(staff.orgId)
  if (!existing) {
    return { error: 'That gym could not be found.' }
  }

  const removeLogo = formData.get('removeLogo') === 'true'

  try {
    let logoPath = existing.logo_path

    if (logo) {
      logoPath = orgLogoPath(staff.orgId, logo.file.type)
      await uploadOrgLogo(logoPath, logo.file)
    } else if (removeLogo) {
      logoPath = null
    }

    await updateOrgProfile(staff.orgId, {
      name: parsed.data.name,
      legal_name: parsed.data.legalName,
      address: parsed.data.address,
      phone: parsed.data.phone,
      email: parsed.data.email,
      pan_no: parsed.data.panNo,
      tax_note: parsed.data.taxNote,
      invoice_terms: parsed.data.invoiceTerms,
      standard_signup_fee_paisa: parsed.data.standardSignupFeePaisa,
      logo_path: logoPath,
    })

    // Only after the row points somewhere else is the old object safe to drop.
    if (existing.logo_path && existing.logo_path !== logoPath) {
      await removeOrgLogo(existing.logo_path).catch(() => {})
    }
  } catch (error) {
    const { message } = (error ?? {}) as DbError
    return { error: message ?? 'Something went wrong. Please try again.' }
  }

  revalidatePath('/settings')
  // The gym's name is rendered in the console header on every page.
  revalidatePath('/', 'layout')

  return { success: 'Letterhead saved.' }
}
