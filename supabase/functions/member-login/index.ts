// member-login -- PIN login for the members' Flutter app.
//
//   POST /member-login   { org_slug, identifier, pin }
//   OPTIONS              -> 204 (no Access-Control-Allow-Origin: native app only)
//
// identifier is the printed card number (1-4 digits) or the phone number.
//
// Responses (all JSON, Cache-Control: no-store):
//   200 { result: 'ok', access_token, refresh_token, expires_in }
//   200 { result: 'invalid' }                         unknown member OR wrong PIN (identical)
//   200 { result: 'locked', retry_after_seconds }
//   400 { error }                                      malformed input
//   429 { result: 'rate_limited' }                     per-IP or per-org ceiling
//   500 { error: 'Something went wrong' }
//
// Session mechanism: the member gets a synthetic Supabase auth user
// (m-<member_id>@members.invalid, linked through members.auth_user_id). After the
// PIN checks out we admin.generateLink({type:'magiclink'}) and redeem the
// hashed_token with verifyOtp on an anon client, which returns a real GoTrue
// session. The access-token hook then stamps org_id / member_id claims exactly as
// for an invited member, so every member RLS policy and RPC works unchanged.
//
// Rate limits are in-memory and per instance (best effort): 10 requests/min per
// client IP and 60 attempts/10 min per org. The database lockout (5 wrong PINs
// -> 15 min) is the real backstop. Never log pins or tokens.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const ORG_SLUG_RE = /^[a-z0-9-]{1,60}$/
const IDENT_RE = /^[0-9]{1,15}$/
const PIN_RE = /^[0-9]{4,6}$/

const IP_LIMIT = 10
const IP_WINDOW_MS = 60_000
const ORG_LIMIT = 60
const ORG_WINDOW_MS = 10 * 60_000

const ipHits = new Map<string, number[]>()
const orgHits = new Map<string, number[]>()

function hit(map: Map<string, number[]>, key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const recent = (map.get(key) ?? []).filter((t) => now - t < windowMs)
  recent.push(now)
  map.set(key, recent)
  if (map.size > 5000) {
    for (const [k, times] of map) {
      if (times.every((t) => now - t >= windowMs)) map.delete(k)
    }
  }
  return recent.length > limit
}

// Last x-forwarded-for hop is the one Supabase's proxy appended.
function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }
  return 'unknown'
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function randomSecret(): string {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405, { Allow: 'POST, OPTIONS' })
  }

  if (hit(ipHits, clientIp(req), IP_LIMIT, IP_WINDOW_MS)) {
    return json({ result: 'rate_limited' }, 429)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json({ error: 'Body must be a JSON object' }, 400)
  }
  const b = body as Record<string, unknown>
  const orgSlug = typeof b.org_slug === 'string' ? b.org_slug.trim() : ''
  const identifier = typeof b.identifier === 'string' ? b.identifier.replace(/[\s\-+()]/g, '') : ''
  const pin = typeof b.pin === 'string' ? b.pin : ''
  if (!ORG_SLUG_RE.test(orgSlug)) return json({ error: 'org_slug must be a gym code' }, 400)
  if (!IDENT_RE.test(identifier)) return json({ error: 'identifier must be digits' }, 400)
  if (!PIN_RE.test(pin)) return json({ error: 'pin must be 4 to 6 digits' }, 400)

  if (hit(orgHits, orgSlug, ORG_LIMIT, ORG_WINDOW_MS)) {
    return json({ result: 'rate_limited' }, 429)
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  try {
    const lookup = await admin.rpc('member_login_lookup', {
      p_org_slug: orgSlug,
      p_identifier: identifier,
    })
    if (lookup.error) throw new Error(`lookup ${lookup.error.code}`)
    const memberId = lookup.data as string | null

    // Unknown member: spend comparable time (one bcrypt compare via the RPC
    // with a random uuid) so response time does not give the answer away.
    const verify = await admin.rpc('verify_member_pin', {
      p_member_id: memberId ?? crypto.randomUUID(),
      p_pin: pin,
    })
    if (verify.error) throw new Error(`verify ${verify.error.code}`)
    const verdict = verify.data as { result: string; retry_after_seconds?: number }

    if (!memberId) {
      await sleep(0)
      return json({ result: 'invalid' })
    }
    if (verdict.result === 'locked') {
      return json({ result: 'locked', retry_after_seconds: verdict.retry_after_seconds })
    }
    if (verdict.result !== 'ok') return json({ result: 'invalid' })

    // PIN is right: make sure the member has an auth user.
    const { data: m, error: mErr } = await admin
      .from('members')
      .select('id, auth_user_id')
      .eq('id', memberId)
      .single()
    if (mErr || !m) throw new Error('member read failed')

    let email: string
    let userId = m.auth_user_id as string | null
    if (userId) {
      const { data: u, error: uErr } = await admin.auth.admin.getUserById(userId)
      if (uErr || !u?.user?.email) throw new Error('auth user read failed')
      email = u.user.email
    } else {
      email = `m-${memberId}@members.invalid`
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email,
        password: randomSecret(),
        email_confirm: true,
        app_metadata: { member_login: true },
      })
      if (cErr || !created?.user) throw new Error(`createUser ${cErr?.status ?? ''}`)
      userId = created.user.id
      const { error: lErr } = await admin
        .from('members')
        .update({ auth_user_id: userId })
        .eq('id', memberId)
        .is('auth_user_id', null)
      if (lErr) throw new Error(`link ${lErr.code}`)
    }

    // Mint a session: magiclink hashed_token -> verifyOtp on an anon client.
    const { data: link, error: gErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })
    const tokenHash = link?.properties?.hashed_token
    if (gErr || !tokenHash) throw new Error(`generateLink ${gErr?.status ?? ''}`)

    const anon = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: sess, error: vErr } = await anon.auth.verifyOtp({
      type: 'magiclink',
      token_hash: tokenHash,
    })
    if (vErr || !sess?.session) throw new Error(`verifyOtp ${vErr?.status ?? ''}`)

    return json({
      result: 'ok',
      access_token: sess.session.access_token,
      refresh_token: sess.session.refresh_token,
      expires_in: sess.session.expires_in,
    })
  } catch (e) {
    console.error('member-login failed', e instanceof Error ? e.message : 'unknown')
    return json({ error: 'Something went wrong' }, 500)
  }
})
