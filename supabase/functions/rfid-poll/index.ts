// rfid-poll -- the door reader asks "has a member scanned my QR?".
//
//   GET  (header x-device-key)
//     200 { "unlock": null, "server_time": <unix s> }     nothing waiting
//     200 { "unlock": { member_name, member_code,
//                       days_to_expiry, status },
//           "server_time": <unix s> }                     open the door now
//
// A member's valid scan (member_door_check_in) queues an unlock request. This
// function hands the newest request younger than 20 s to the reader exactly
// once (rfid_poll_unlock consumes it atomically); older requests are never
// honoured, so a late scan cannot open the door. Poll about once a second
// while idle and online.
//
// Auth model: same as rfid-check. `verify_jwt: false` on purpose; the reader's
// only credential is the `x-device-key` header, hashed here (sha256 hex) so
// only the hash reaches Postgres. The service-role key is used solely to call
// rfid_poll_unlock, which is executable by service_role only.
//
// Status codes: 401 missing/unknown key, 403 disabled reader, 405 other
// methods, 500 anything unexpected (generic; details stay in the logs).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'GET only' }, 405)
  }

  const deviceKey = req.headers.get('x-device-key')?.trim()
  if (!deviceKey) {
    return jsonResponse({ decision: 'deny', reason: 'device_unknown' }, 401)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const { data, error } = await admin.rpc('rfid_poll_unlock', {
    p_key_hash: await sha256Hex(deviceKey),
  })
  if (error) {
    console.error('rfid_poll_unlock failed', error.code, error.message)
    return jsonResponse({ error: 'Poll failed' }, 500)
  }

  const result = data as {
    decision?: string
    reason?: string
    unlock?: Record<string, unknown> | null
    server_time?: number
  } | null
  if (result?.reason === 'device_unknown') return jsonResponse(result, 401)
  if (result?.reason === 'device_disabled') return jsonResponse(result, 403)
  if (result?.decision !== 'ok') {
    console.error('rfid_poll_unlock unexpected shape')
    return jsonResponse({ error: 'Poll failed' }, 500)
  }

  return jsonResponse({ unlock: result.unlock ?? null, server_time: result.server_time })
})
