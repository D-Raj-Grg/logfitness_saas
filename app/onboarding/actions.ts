'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { onboardingSchema } from '@/lib/validation/auth'

export type OnboardingFormState = {
  error?: string
  fieldErrors?: Record<string, string[]>
}

export async function createOrganization(
  _prevState: OnboardingFormState,
  formData: FormData
): Promise<OnboardingFormState> {
  const parsed = onboardingSchema.safeParse({
    orgName: formData.get('orgName'),
    branchName: formData.get('branchName'),
    ownerName: formData.get('ownerName'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const supabase = await createClient()

  const { error } = await supabase.rpc('create_org_with_owner', {
    p_org_name: parsed.data.orgName,
    p_branch_name: parsed.data.branchName,
    p_owner_name: parsed.data.ownerName,
  })

  if (error) {
    return { error: error.message }
  }

  // The org, branch, and owner rows exist, but the caller's access token was
  // issued before they did. Refresh it so the auth hook can attach the tenant
  // claims that every RLS policy reads.
  await supabase.auth.refreshSession()

  redirect('/')
}
