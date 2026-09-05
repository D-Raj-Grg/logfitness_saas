// push-fanout -- sends a push notification to one member, a list of members,
// or every live member of a branch, via FCM HTTP v1.
//
// Auth model (two layers):
//   1. `verify_jwt: true` on this function means the Supabase gateway already
//      rejected the request if the Authorization header does not carry a
//      valid, signed Supabase JWT. That only proves *someone* is signed in.
//   2. The body names an org and a target, and a body is never trusted for
//      authorization. So this function builds a second Supabase client using
//      the caller's own JWT (not the service-role key) and calls the
//      `current_staff()` RPC through it -- RLS-scoped, security definer,
//      driven by `auth.uid()` from the token, exactly the same call the
//      console itself uses to know who is signed in. Only once that proves
//      the caller is active staff of the org named in the body -- and, for a
//      branch target, that the caller can reach that branch -- does the
//      function switch to the service-role key to resolve tokens and send.
//
// The service-role key is used ONLY after that check, and only for the parts
// RLS would otherwise legitimately block a staff member from doing on their
// own: reading another member's device token id and writing push_log/
// device_tokens rows that don't belong to the caller.
//
// FCM v1 requires OAuth2 access token minted from a service account, read
// from the FCM_SERVICE_ACCOUNT_JSON project secret. That secret can only be
// set from the Supabase dashboard or a logged-in CLI -- neither is available
// in the environment this function was written in -- so if the secret is
// unset this function returns a clear 503 rather than crashing, and the send
// path has NOT been exercised end to end. See the deployment report.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

interface PushRequest {
  org_id: string
  member_id?: string
  member_ids?: string[]
  branch_id?: string
  title: string
  body: string
  data?: Record<string, string>
}

interface ServiceAccount {
  client_email: string
  private_key: string
  project_id: string
  token_uri?: string
}

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const TOKEN_URI = 'https://oauth2.googleapis.com/token'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let str = ''
  for (const b of arr) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlJson(obj: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)))
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

// Mints a Google OAuth2 access token from a service account, using RS256
// JWT-bearer exchange (https://developers.google.com/identity/protocols/oauth2/service-account).
// Deliberately dependency-free: WebCrypto can sign RS256 without a JWT
// library, and Edge Functions already have it.
async function getGoogleAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: sa.client_email,
    scope: FCM_SCOPE,
    aud: sa.token_uri ?? TOKEN_URI,
    iat: now,
    exp: now + 3600,
  }
  const unsigned = `${base64urlJson(header)}.${base64urlJson(claims)}`

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned)
  )
  const assertion = `${unsigned}.${base64url(signature)}`

  const resp = await fetch(sa.token_uri ?? TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  if (!resp.ok) {
    // Never include the assertion or the service account in the error --
    // both are secrets.
    throw new Error(`Google token exchange failed with status ${resp.status}`)
  }
  const json = await resp.json()
  return json.access_token as string
}

interface DeviceTokenRow {
  id: string
  member_id: string | null
  token: string
}

interface SendResult {
  device_token_id: string
  member_id: string | null
  status: 'sent' | 'failed' | 'unregistered'
  error: string | null
}

async function sendOne(
  accessToken: string,
  projectId: string,
  row: DeviceTokenRow,
  title: string,
  body: string,
  data: Record<string, string> | undefined
): Promise<SendResult> {
  try {
    const resp = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: row.token,
            notification: { title, body },
            data,
          },
        }),
      }
    )

    if (resp.ok) {
      return { device_token_id: row.id, member_id: row.member_id, status: 'sent', error: null }
    }

    const payload = await resp.json().catch(() => null)
    // FCM v1 reports a dead token as this specific error status. Anything
    // else is a transient or configuration failure, not proof the device is
    // gone.
    const fcmStatus = payload?.error?.status as string | undefined
    if (fcmStatus === 'UNREGISTERED') {
      return {
        device_token_id: row.id,
        member_id: row.member_id,
        status: 'unregistered',
        error: 'UNREGISTERED',
      }
    }
    return {
      device_token_id: row.id,
      member_id: row.member_id,
      status: 'failed',
      // Never surface the token; the FCM error message does not contain it.
      error: payload?.error?.message ?? `FCM responded ${resp.status}`,
    }
  } catch (err) {
    return {
      device_token_id: row.id,
      member_id: row.member_id,
      status: 'failed',
      error: err instanceof Error ? err.message : 'Unknown send error',
    }
  }
}

/** One request cannot fan out to an unbounded slice of the chain. */
const MAX_MEMBER_IDS = 500

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POST only' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401)
  }

  let body: PushRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.org_id || !body.title || !body.body) {
    return jsonResponse({ error: 'org_id, title, and body are required' }, 400)
  }

  const targets = [body.member_id, body.member_ids, body.branch_id].filter(
    (t) => t !== undefined
  )
  if (targets.length !== 1) {
    return jsonResponse(
      { error: 'Name exactly one target: member_id, member_ids, or branch_id' },
      400
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Layer 2 of the auth model: the caller's own JWT, RLS-scoped. Never trust
  // body.org_id -- ask Postgres who this token actually belongs to.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  const { data: staffRows, error: staffError } = await callerClient.rpc('current_staff')
  if (staffError) {
    return jsonResponse({ error: 'Could not verify caller' }, 500)
  }
  const staff = Array.isArray(staffRows) ? staffRows[0] : staffRows
  if (!staff) {
    return jsonResponse({ error: 'Caller is not active staff' }, 403)
  }
  if (staff.org_id !== body.org_id) {
    return jsonResponse({ error: 'Caller is not staff of this org' }, 403)
  }
  if (body.branch_id && !(staff.branch_ids ?? []).includes(body.branch_id)) {
    return jsonResponse({ error: 'Caller cannot reach this branch' }, 403)
  }

  // The secret this whole path depends on. It can only be provisioned from
  // the dashboard or a logged-in CLI, and neither was available while
  // writing this function -- so this is the one place that can fail in a
  // way nothing above it could catch, and it must fail loudly, not crash.
  const saJson = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON')
  if (!saJson) {
    return jsonResponse(
      {
        error:
          'FCM_SERVICE_ACCOUNT_JSON is not set. This function is deployed but ' +
          'the push send path is unprovisioned -- set the secret from the ' +
          'Supabase dashboard (Edge Functions -> push-fanout -> Secrets) or ' +
          'a logged-in CLI, then retry.',
      },
      503
    )
  }

  let serviceAccount: ServiceAccount
  try {
    serviceAccount = JSON.parse(saJson)
    if (!serviceAccount.client_email || !serviceAccount.private_key || !serviceAccount.project_id) {
      throw new Error('missing required fields')
    }
  } catch {
    // Never echo the secret's content back in the response.
    return jsonResponse({ error: 'FCM_SERVICE_ACCOUNT_JSON is set but malformed' }, 503)
  }

  // From here on, RLS would legitimately block staff from reading a member's
  // device token -- that is the whole point of that policy -- so the
  // service-role key does the fanout read, gated only by the org/branch
  // authorization already established above.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  let memberIds: string[]
  if (body.member_id) {
    memberIds = [body.member_id]
  } else if (body.member_ids) {
    if (body.member_ids.length > MAX_MEMBER_IDS) {
      return jsonResponse(
        { error: `Name at most ${MAX_MEMBER_IDS} members in one call` },
        400
      )
    }
    // Deduplicated so a repeated id cannot look like a missing one to the
    // reachability check below.
    memberIds = [...new Set(body.member_ids)]
  } else {
    const { data: members, error: membersError } = await adminClient
      .from('members')
      .select('id')
      .eq('org_id', body.org_id)
      .eq('home_branch_id', body.branch_id)
      .neq('status', 'left')
    if (membersError) {
      return jsonResponse({ error: 'Could not resolve branch members' }, 500)
    }
    memberIds = (members ?? []).map((m: { id: string }) => m.id)
  }

  if (memberIds.length === 0) {
    return jsonResponse({ sent: 0, failed: 0, unregistered: 0, revoked: 0 })
  }

  // Branch scoping applies to every target shape, not just `branch_id`.
  // Checking it only there left the member targets scoped by org alone, which
  // let a front desk at one branch push arbitrary content to the whole chain.
  // A member's branch is their home branch, so resolve it and compare against
  // what the caller can actually reach. An owner's current_staff() already
  // expands branch_ids to every branch in the org, so this covers them too.
  const { data: targetBranches, error: targetBranchesError } = await adminClient
    .from('members')
    .select('id, home_branch_id')
    .eq('org_id', body.org_id)
    .in('id', memberIds)

  if (targetBranchesError) {
    return jsonResponse({ error: 'Could not resolve member branches' }, 500)
  }

  const reachable = new Set(staff.branch_ids ?? [])
  const outOfReach = (targetBranches ?? []).filter(
    (m: { home_branch_id: string }) => !reachable.has(m.home_branch_id)
  )

  // A member id the caller cannot reach and one that does not exist get the
  // same answer, so this cannot be used to enumerate the chain's membership.
  if (outOfReach.length > 0 || (targetBranches ?? []).length !== memberIds.length) {
    return jsonResponse({ error: 'Caller cannot reach one of those members' }, 403)
  }

  const { data: tokenRows, error: tokensError } = await adminClient
    .from('device_tokens')
    .select('id, member_id, token')
    .eq('org_id', body.org_id)
    .in('member_id', memberIds)
    .is('revoked_at', null)

  if (tokensError) {
    return jsonResponse({ error: 'Could not resolve device tokens' }, 500)
  }
  const tokens = (tokenRows ?? []) as DeviceTokenRow[]

  if (tokens.length === 0) {
    return jsonResponse({ sent: 0, failed: 0, unregistered: 0, revoked: 0 })
  }

  let accessToken: string
  try {
    accessToken = await getGoogleAccessToken(serviceAccount)
  } catch (err) {
    return jsonResponse(
      { error: `Could not obtain an FCM access token: ${err instanceof Error ? err.message : 'unknown error'}` },
      502
    )
  }

  const results = await Promise.all(
    tokens.map((row) =>
      sendOne(accessToken, serviceAccount.project_id, row, body.title, body.body, body.data)
    )
  )

  const unregisteredIds = results
    .filter((r) => r.status === 'unregistered')
    .map((r) => r.device_token_id)

  if (unregisteredIds.length > 0) {
    // One batch update, as required -- not one write per dead token.
    await adminClient
      .from('device_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .in('id', unregisteredIds)
  }

  await adminClient.from('push_log').insert(
    results.map((r) => ({
      org_id: body.org_id,
      member_id: r.member_id,
      device_token_id: r.device_token_id,
      title: body.title,
      status: r.status,
      error: r.error,
    }))
  )

  return jsonResponse({
    sent: results.filter((r) => r.status === 'sent').length,
    failed: results.filter((r) => r.status === 'failed').length,
    unregistered: unregisteredIds.length,
    revoked: unregisteredIds.length,
  })
})
