// public-balance -- the public balance API behind the QR printed on a member's
// card. A gym's own site (or the console's /balance page) asks "who holds card
// 0004 at omega-fit, and how many days are left?" and may file a "please renew
// me" request on the member's behalf. Nobody signs in.
//
//   GET  /public-balance?org=<slug>&card_no=<n>          -> public_card_balance
//   POST /public-balance/renew-request                    -> public_renewal_request
//        { org, card_no, phone?, note? }
//   OPTIONS                                               -> 204 CORS preflight
//
// Auth model:
//   - `verify_jwt: false` is deliberate, and there is no caller secret either:
//     the page is opened by a member off a printed QR, in a browser, from the
//     gym's own site. Anything we handed that page would be public anyway.
//   - The service-role key is used solely to call the two RPCs above, which
//     are security definer and executable by service_role only. They answer
//     only what a stranger holding the card could already guess (masked name,
//     plan, status, days left) -- the limit is in Postgres, not here.
//   - The org is resolved by slug inside Postgres. Nothing in the request is
//     trusted for identity; the input is only validated for shape before it
//     reaches the RPC.
//
// Status codes: business answers (org_not_found, card_not_found,
// card_unassigned, ok) are 200 with the RPC's jsonb verbatim -- they are
// answers, not errors. too_soon -> 429. 400 malformed input, 404 unknown
// path, 405 wrong method (with Allow), 429 rate limited, 500 anything
// unexpected (generic; details stay in the logs).
//
// CORS: BALANCE_ALLOWED_ORIGINS (optional function secret, comma-separated)
// lists the gym sites allowed to call this from the browser; the request's
// Origin is echoed when it is in the list. Unset, every origin is allowed --
// the data is public by design, so the list only trims abuse surface.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const ORG_SLUG_RE = /^[a-z0-9-]{1,60}$/
const CARD_NO_MIN = 1
const CARD_NO_MAX = 9999
const PHONE_MAX = 20
const NOTE_MAX = 500

// --- CORS -------------------------------------------------------------------

const allowedOrigins = (Deno.env.get('BALANCE_ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter((s) => s.length > 0)

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')?.replace(/\/$/, '') ?? ''
  let allow: string
  if (allowedOrigins.length === 0) {
    allow = '*'
  } else if (origin && allowedOrigins.includes(origin)) {
    allow = origin
  } else {
    // Not on the list: name the first allowed origin so the browser refuses
    // the response for everyone else. The data itself is still public.
    allow = allowedOrigins[0]
  }
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    // content-type for plain fetch; the rest so supabase.functions.invoke works too.
    'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  }
}

function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

// --- Rate limiting ----------------------------------------------------------
//
// Best-effort sliding window per client IP. It lives in this instance's
// memory only: a cold start resets it and parallel instances do not share it,
// so it slows a careless loop rather than stopping a determined one. For
// renew requests the real backstop is the database's too_soon rule (one
// pending request per member, repeats within ten minutes refused).

const RATE_LIMIT = 30
const RATE_WINDOW_MS = 60_000
const hits = new Map<string, number[]>()

// The LAST x-forwarded-for entry is the one Supabase's proxy appended; the
// first is whatever the client chose to send and would let it rotate past the
// limit. No other client-IP header is trusted: anything else is client-set.
function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }
  return 'unknown'
}

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  recent.push(now)
  hits.set(ip, recent)
  // Keep the map from growing without bound on a long-lived instance.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(key)
    }
  }
  return recent.length > RATE_LIMIT
}

// --- Input ------------------------------------------------------------------

function parseOrgSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const slug = value.trim()
  return ORG_SLUG_RE.test(slug) ? slug : null
}

// "4", "04", "0004", "NO. 0004" -> 4. Mirrors public.parse_card_no.
function parseCardNo(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (typeof value === 'number' && !Number.isInteger(value)) return null
  const digits = String(value).replace(/[^0-9]/g, '')
  if (digits === '' || digits.length > 4) return null
  const n = Number.parseInt(digits, 10)
  if (!Number.isInteger(n) || n < CARD_NO_MIN || n > CARD_NO_MAX) return null
  return n
}

function parsePhone(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 200) return undefined
  const digits = value.replace(/[^0-9+]/g, '')
  if (digits.length > PHONE_MAX) return undefined
  return digits === '' ? null : digits
}

function parseNote(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  const note = value.trim()
  if (note.length > NOTE_MAX) return undefined
  return note === '' ? null : note
}

function adminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })
}

// --- Handler ----------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }

  // Deployed at /functions/v1/public-balance[/...]; the sub-path is what we route on.
  const pathname = new URL(req.url).pathname.replace(/\/+$/, '')
  const subPath = pathname.replace(/^.*?\/public-balance/, '')

  const isBalance = req.method === 'GET' && subPath === ''
  const isRenew = req.method === 'POST' && subPath === '/renew-request'
  if (!isBalance && !isRenew) {
    const knownPath = subPath === '' || subPath === '/renew-request'
    if (!knownPath) return jsonResponse(req, { error: 'Not found' }, 404)
    return new Response(
      JSON.stringify({ error: 'GET /public-balance or POST /public-balance/renew-request' }),
      {
        status: 405,
        headers: {
          ...corsHeaders(req),
          'Content-Type': 'application/json',
          Allow: subPath === '' ? 'GET, OPTIONS' : 'POST, OPTIONS',
        },
      },
    )
  }

  if (rateLimited(clientIp(req))) {
    return jsonResponse(req, { error: 'Too many requests' }, 429)
  }

  if (isBalance) {
    const url = new URL(req.url)
    const org = parseOrgSlug(url.searchParams.get('org'))
    if (!org) return jsonResponse(req, { error: 'org must be a gym code' }, 400)
    const cardNo = parseCardNo(url.searchParams.get('card_no'))
    if (cardNo === null) {
      return jsonResponse(req, { error: 'card_no must be 1–9999' }, 400)
    }

    const { data, error } = await adminClient().rpc('public_card_balance', {
      p_org_slug: org,
      p_card_no: cardNo,
    })
    if (error) {
      console.error('public_card_balance failed', error.code, error.message)
      return jsonResponse(req, { error: 'Something went wrong' }, 500)
    }
    return jsonResponse(req, data, 200)
  }

  // POST /renew-request
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonResponse(req, { error: 'Invalid JSON body' }, 400)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return jsonResponse(req, { error: 'Body must be a JSON object' }, 400)
  }
  const b = body as Record<string, unknown>

  const org = parseOrgSlug(b.org)
  if (!org) return jsonResponse(req, { error: 'org must be a gym code' }, 400)
  const cardNo = parseCardNo(b.card_no)
  if (cardNo === null) {
    return jsonResponse(req, { error: 'card_no must be 1–9999' }, 400)
  }
  const phone = parsePhone(b.phone)
  if (phone === undefined) {
    return jsonResponse(req, { error: `phone must be at most ${PHONE_MAX} digits` }, 400)
  }
  const note = parseNote(b.note)
  if (note === undefined) {
    return jsonResponse(req, { error: `note must be at most ${NOTE_MAX} characters` }, 400)
  }

  const { data, error } = await adminClient().rpc('public_renewal_request', {
    p_org_slug: org,
    p_card_no: cardNo,
    p_phone: phone ?? undefined,
    p_note: note ?? undefined,
  })
  if (error) {
    console.error('public_renewal_request failed', error.code, error.message)
    return jsonResponse(req, { error: 'Something went wrong' }, 500)
  }

  const result = data as { result?: string } | null
  return jsonResponse(req, data, result?.result === 'too_soon' ? 429 : 200)
})
