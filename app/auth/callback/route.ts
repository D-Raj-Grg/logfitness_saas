import { NextResponse, type NextRequest } from 'next/server'

import { safeNext } from '@/lib/safe-next'
import { createClient } from '@/lib/supabase/server'

/**
 * Completes a PKCE email link -- today only the password-reset email -- by
 * exchanging its code for a session, then forwards to the page the link asked
 * for. Cookie writes need a Route Handler, as /auth/link explains.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const next = safeNext(request.nextUrl.searchParams.get('next'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(new URL(next, request.url))
    }
  }

  const url = new URL('/forgot-password', request.url)
  url.searchParams.set('error', 'expired')
  return NextResponse.redirect(url)
}
