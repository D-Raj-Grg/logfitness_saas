import { redirect } from 'next/navigation'

import { ResetPasswordForm } from '@/components/auth/reset-password-form'
import { createClient } from '@/lib/supabase/server'

/**
 * Reached only through the emailed reset link, which /auth/callback turns
 * into a session. Anyone here without one has nothing to update.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/forgot-password')
  }

  return <ResetPasswordForm />
}
