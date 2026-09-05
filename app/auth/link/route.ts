import { NextResponse, type NextRequest } from 'next/server'

import { CLAIMS_REFRESH_COOKIE } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/**
 * Claims a pending staff invitation for the signed-in account.
 *
 * This has to be a Route Handler rather than part of a page render. Tenant
 * claims are stamped into the access token when it is issued, so adopting a
 * staff row only takes effect after the session is refreshed -- and a Server
 * Component cannot persist the refreshed cookies, which would leave the browser
 * holding a claimless token until it happened to expire.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const { error } = await supabase.rpc('link_staff_account')

  if (error) {
    // No invitation waiting: this account is starting a new gym instead.
    return NextResponse.redirect(new URL('/onboarding', request.url))
  }

  await supabase.auth.refreshSession()

  const response = NextResponse.redirect(new URL('/', request.url))

  // Marks that a refresh has just been attempted, so a token that still lacks
  // claims renders an empty page rather than bouncing back here forever.
  response.cookies.set(CLAIMS_REFRESH_COOKIE, '1', {
    maxAge: 30,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  })

  return response
}
