import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import type { Database } from '@/lib/types/database'

/** Routes reachable without a session. Everything else requires one. */
const PUBLIC_PREFIXES = ['/login', '/signup', '/auth', '/forgot-password']

/**
 * The printed-document design harness. It renders fixtures, touches no
 * database, and its layout 404s outside development -- but it must also be
 * reachable without signing in, or it cannot serve its purpose. Gated here on
 * NODE_ENV as well, so production never even resolves the prefix.
 */
const DEV_ONLY_PREFIXES =
  process.env.NODE_ENV === 'production' ? [] : ['/documents']

function isPublicPath(pathname: string) {
  return [...PUBLIC_PREFIXES, ...DEV_ONLY_PREFIXES].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

/**
 * Refreshes the Supabase session cookie and gates unauthenticated traffic.
 *
 * This is an optimistic check only: it decides whether a request may reach a
 * page at all. Authorization -- which org, which branch, which role -- is
 * enforced by RLS in the database, never here.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Do not put code between createServerClient and getClaims(): anything that
  // delays this call can leave users randomly signed out.
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims

  const { pathname } = request.nextUrl

  if (!claims && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  if (claims && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // Return this exact response object: replacing it drops the refreshed cookies
  // and desynchronises the browser session.
  return response
}
