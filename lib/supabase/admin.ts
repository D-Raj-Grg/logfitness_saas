import { createClient as createSupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/types/database'

/**
 * A service-role client for the handful of operations that the caller's own
 * session cannot perform -- today, only setting another staff member's
 * password through the Auth admin API.
 *
 * This bypasses RLS entirely, so it must only ever be created inside a Server
 * Action or Route Handler that has already authorised the caller through the
 * normal RLS-bound client. Never hand it a query that RLS could have run.
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
