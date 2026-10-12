// rfid-check -- the door reader's endpoint. An ESP32 + RC522 reader POSTs
// { uid, ts?, fw? } with its device key in the `x-device-key` header; this
// function answers allow/deny for the OLED and buzzer.
//
// Auth model:
//   - `verify_jwt: false` is deliberate. A reader is not a Supabase user and
//     holds no JWT; its only credential is the device key minted by
//     register_device / rotate_device_key.
//   - The key is hashed here (sha256, hex) and the hash is the only thing
//     passed to Postgres. public.rfid_check_in() looks the device up by that
//     hash and derives org and branch from the device row. Nothing in the
//     request body is trusted for org, branch or member -- the body only
//     carries the card UID.
//   - The service-role key is used solely to call rfid_check_in, which is
//     executable by service_role only. It is security definer and does every
//     read and write itself.
//
// Status codes: 401 missing/unknown key, 403 disabled reader, 400 malformed
// body, 500 anything unexpected (generic, details stay in the logs), else 200
// with the RPC's jsonb verbatim -- including business denials (dues, expired,
// unknown_card ...), which are answers, not errors.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

interface CheckRequest {
  uid?: unknown
  ts?: unknown
  fw?: unknown
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// The reader's RTC time: epoch seconds (number) or an ISO string. Optional.
function parseScannedAt(ts: unknown): string | null | undefined {
  if (ts === undefined || ts === null) return null
  let ms: number
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    ms = ts * 1000
  } else if (typeof ts === 'string' && ts.length <= 40) {
    ms = Date.parse(ts)
  } else {
    return undefined
  }
  // Outside the range Date can represent, toISOString() would throw.
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return undefined
  return new Date(ms).toISOString()
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POST only' }, 405)
  }

  const deviceKey = req.headers.get('x-device-key')?.trim()
  if (!deviceKey) {
    return jsonResponse({ decision: 'deny', reason: 'device_unknown' }, 401)
  }

  let body: CheckRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body !== 'object' || body === null) {
    return jsonResponse({ error: 'Body must be a JSON object' }, 400)
  }
  if (typeof body.uid !== 'string' || body.uid.trim() === '' || body.uid.length > 64) {
    return jsonResponse({ error: 'uid is required' }, 400)
  }
  if (body.fw !== undefined && (typeof body.fw !== 'string' || body.fw.length > 40)) {
    return jsonResponse({ error: 'fw must be a short string' }, 400)
  }
  const scannedAt = parseScannedAt(body.ts)
  if (scannedAt === undefined) {
    return jsonResponse({ error: 'ts must be epoch seconds or an ISO timestamp' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  const { data, error } = await admin.rpc('rfid_check_in', {
    p_key_hash: await sha256Hex(deviceKey),
    p_card_uid: body.uid as string,
    p_scanned_at: scannedAt ?? undefined,
  })

  if (error) {
    console.error('rfid_check_in failed', error.code, error.message)
    return jsonResponse({ error: 'Check-in failed' }, 500)
  }

  const result = data as { reason?: string } | null
  if (result?.reason === 'device_unknown') return jsonResponse(result, 401)
  if (result?.reason === 'device_disabled') return jsonResponse(result, 403)
  return jsonResponse(result, 200)
})
