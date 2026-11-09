import { createClient as createSupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/types/database'

/**
 * A service-role client for the handful of operations that the caller's own
 * session cannot perform. Two sanctioned uses:
 *
 *   1. Setting another staff member's password through the Auth admin API,
 *      from a Server Action that has already authorised the caller through
 *      the normal RLS-bound client.
 *   2. The public balance page (lib/db/public-balance.ts), which has no
 *      caller to authorise: it calls `public_card_balance` and
 *      `public_renewal_request`, RPCs executable by service_role only that
 *      are the anonymous contract and scope themselves -- org by slug, and
 *      only what a stranger holding the card could already guess.
 *
 * This bypasses RLS entirely. Never hand it a query that RLS could have run,
 * and never a table read on behalf of an anonymous visitor.
 *
 * Fluid compute reuses instances across requests, so this is created per call
 * rather than hoisted to module scope, matching lib/supabase/server.ts.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  }

  return createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
