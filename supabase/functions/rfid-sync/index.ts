// rfid-sync -- the door reader's offline-mode endpoint.
//
//   GET  ?after=<uid>&limit=<n>   the card list, one page. text/plain, one
//                                 "UID,YYYYMMDD,C,Name" line per live card (Name:
//                                 the holder, printable ASCII, <= 20 chars, may be
//                                 empty), where C
//                                 is A allowed (YYYYMMDD = last day it may
//                                 enter), D dues owing, E expired, F frozen,
//                                 U not started, N no membership, L left,
//                                 S a staff card allowed at this door (clock
//                                 in/out; YYYYMMDD is the open-ended 20991231).
//                                 (YYYYMMDD is the day the membership ended for E,
//                                 and 00000000 for the other codes.) Then:
//                                   #END,<org-today YYYYMMDD>
//                                   #MORE,<last uid>,<org-today YYYYMMDD>
//   GET  ?qr=1                    the door-QR config as JSON (not the card list):
//                                 { "qr": { "qr_id": 7, "secret_b64": "..." },
//                                   "server_time": <unix seconds> }
//                                 The reader keeps the secret in flash and derives
//                                 the rotating 8-digit code from it (see the
//                                 firmware README, "QR protocol"). Active readers
//                                 only; a plain GET is unchanged.
//   POST { events: [{ uid, ts }] }  backfill taps the reader let in while
//                                 offline (max 100). ts = epoch seconds or ISO.
//                                 The reply counts accepted / duplicate /
//                                 unknown / clamped / bad_uid and staff_clocked
//                                 (staff taps replayed as clock-ins/outs at the
//                                 tap time).
//
// Same auth model as rfid-check: `verify_jwt: false` on purpose, the reader's
// only credential is the `x-device-key` header; the key is hashed here and only
// the hash reaches Postgres. The service-role key is used solely to call
// rfid_sync_cards / rfid_log_offline / rfid_qr_config, all executable by
// service_role only.
//
// Status codes: 401 missing/unknown key, 403 disabled reader, 400 malformed
// request, 405 other methods, 500 anything unexpected (details stay in logs).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function textResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// epoch seconds (number) or an ISO string -> ISO string, null when absent,
// undefined when malformed.
function parseTs(ts: unknown): string | null | undefined {
  if (ts === undefined || ts === null) return null
  let ms: number
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    ms = ts * 1000
  } else if (typeof ts === 'string' && ts.length <= 40) {
    ms = Date.parse(ts)
  } else {
    return undefined
  }
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return undefined
  return new Date(ms).toISOString()
}

const MAX_EVENTS = 100

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'GET or POST only' }, 405)
  }

  const deviceKey = req.headers.get('x-device-key')?.trim()
  if (!deviceKey) {
    return jsonResponse({ decision: 'deny', reason: 'device_unknown' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
  const keyHash = await sha256Hex(deviceKey)

  if (req.method === 'GET') {
    const url = new URL(req.url)

    // Door-QR config: opt-in, so the text card list below stays byte-identical
    // for readers that do not ask for it (firmware 1.3.0 and older).
    if (url.searchParams.get('qr') === '1') {
      const { data: q, error: qErr } = await admin.rpc('rfid_qr_config', {
        p_key_hash: keyHash,
      })
      if (qErr) {
        console.error('rfid_qr_config failed', qErr.code, qErr.message)
        return jsonResponse({ error: 'Sync failed' }, 500)
      }
      const qr = q as {
        decision?: string
        reason?: string
        qr?: { qr_id: number; secret_b64: string }
        server_time?: number
      } | null
      if (qr?.reason === 'device_unknown') return jsonResponse(qr, 401)
      if (qr?.reason === 'device_disabled') return jsonResponse(qr, 403)
      if (qr?.decision !== 'ok' || !qr.qr) {
        console.error('rfid_qr_config unexpected shape')
        return jsonResponse({ error: 'Sync failed' }, 500)
      }
      return jsonResponse({ qr: qr.qr, server_time: qr.server_time })
    }

    const after =url.searchParams.get('after')
    if (after !== null && (after.length > 40 || !/^[0-9A-Fa-f:\- ]*$/.test(after))) {
      return jsonResponse({ error: 'after must be a card UID' }, 400)
    }
    const limitParam = url.searchParams.get('limit')
    const limit = limitParam === null ? 1000 : Number(limitParam)
    if (!Number.isInteger(limit) || limit < 1 || limit > 2000) {
      return jsonResponse({ error: 'limit must be an integer 1..2000' }, 400)
    }

    const { data, error } = await admin.rpc('rfid_sync_cards', {
      p_key_hash: keyHash,
      p_after: after && after.length > 0 ? after : undefined,
      p_limit: limit,
    })
    if (error) {
      console.error('rfid_sync_cards failed', error.code, error.message)
      return jsonResponse({ error: 'Sync failed' }, 500)
    }

    const result = data as {
      decision?: string
      reason?: string
      cards?: [string, string, string, string?][]
      more?: boolean
      last_uid?: string
      org_today?: string
    } | null
    if (result?.reason === 'device_unknown') return jsonResponse(result, 401)
    if (result?.reason === 'device_disabled') return jsonResponse(result, 403)
    if (result?.decision !== 'ok' || !Array.isArray(result.cards)) {
      console.error('rfid_sync_cards unexpected shape')
      return jsonResponse({ error: 'Sync failed' }, 500)
    }

    // UID,YYYYMMDD,C,Name. The name comes last and the database has already
    // folded it to printable ASCII without commas; strip again here so a stray
    // comma or line break can never split a line.
    const lines = result.cards.map(
      ([uid, until, code, name]) =>
        `${uid},${until},${code},${(name ?? '').replace(/[,\r\n]/g, ' ')}`,
    )
    lines.push(
      result.more
        ? `#MORE,${result.last_uid},${result.org_today}`
        : `#END,${result.org_today}`,
    )
    return textResponse(lines.join('\n') + '\n')
  }

  // POST: backfill offline taps
  let body: { events?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }
  if (typeof body !== 'object' || body === null || !Array.isArray(body.events)) {
    return jsonResponse({ error: 'events must be an array' }, 400)
  }
  if (body.events.length === 0 || body.events.length > MAX_EVENTS) {
    return jsonResponse({ error: `events must hold 1..${MAX_EVENTS} items` }, 400)
  }

  const events: { uid: string; ts: string | null }[] = []
  for (const raw of body.events) {
    const e = raw as { uid?: unknown; ts?: unknown } | null
    if (typeof e !== 'object' || e === null) {
      return jsonResponse({ error: 'each event must be an object' }, 400)
    }
    if (typeof e.uid !== 'string' || e.uid.trim() === '' || e.uid.length > 64) {
      return jsonResponse({ error: 'each event needs a uid' }, 400)
    }
    const ts = parseTs(e.ts)
    if (ts === undefined) {
      return jsonResponse({ error: 'ts must be epoch seconds or an ISO timestamp' }, 400)
    }
    events.push({ uid: e.uid, ts })
  }

  const { data, error } = await admin.rpc('rfid_log_offline', {
    p_key_hash: keyHash,
    p_events: events,
  })
  if (error) {
    console.error('rfid_log_offline failed', error.code, error.message)
    return jsonResponse({ error: 'Upload failed' }, 500)
  }

  const result = data as { decision?: string; reason?: string } | null
  if (result?.reason === 'device_unknown') return jsonResponse(result, 401)
  if (result?.reason === 'device_disabled') return jsonResponse(result, 403)
  if (result?.decision !== 'ok') {
    console.error('rfid_log_offline refused', result?.reason)
    return jsonResponse({ error: 'Upload failed' }, 500)
  }
  return jsonResponse(result, 200)
})
