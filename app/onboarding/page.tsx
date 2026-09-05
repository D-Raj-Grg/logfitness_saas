import { Dumbbell } from 'lucide-react'
import { redirect } from 'next/navigation'

import { OnboardingForm } from '@/components/auth/onboarding-form'
import { getCurrentStaff } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export default async function OnboardingPage() {
  const staff = await getCurrentStaff()

  // Already attached to an org: nothing to set up.
  if (staff) {
    redirect('/')
  }

  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex items-center gap-2 font-semibold">
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Dumbbell className="size-4" />
        </span>
        Lord of Gyms
      </div>
      <div className="w-full max-w-sm">
        <OnboardingForm defaultName={data.user?.email?.split('@')[0]} />
      </div>
    </div>
  )
}
