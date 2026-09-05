/**
 * Renders every Phase 1 route against the running dev server as a real signed-in
 * staff member, and asserts the seeded data actually reaches the page. This is
 * the check that catches what `next build` cannot: RLS, claims, and data wiring.
 *
 *   npm run dev                     # in one terminal
 *   SMOKE_PASSWORD=... npm run smoke
 *
 * The account is the demo owner created by supabase/seed.sql. It exists only in
 * development; there is no production path that creates it.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const ENV_FILE = process.env.ENV_FILE ?? '.env.local'
const BASE = process.env.BASE ?? 'http://localhost:3000'
const EMAIL = process.env.SMOKE_EMAIL ?? 'owner@everest.test'
const PASSWORD = process.env.SMOKE_PASSWORD

if (!PASSWORD) {
  console.error('Set SMOKE_PASSWORD to the demo owner password.')
  process.exit(1)
}

const env = Object.fromEntries(
  fs
    .readFileSync(ENV_FILE, 'utf8')
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => {
      const i = line.indexOf('=')
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()]
    })
)

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

const supabase = createClient(supabaseUrl, supabaseKey)
const { data, error } = await supabase.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD,
})

if (error) {
  console.error('Sign-in failed:', error.message)
  process.exit(1)
}

const claims = JSON.parse(
  Buffer.from(data.session.access_token.split('.')[1], 'base64url').toString()
)

if (!claims.org_id) {
  console.error('The access token carries no org_id claim -- is the auth hook enabled?')
  process.exit(1)
}

console.log(
  'Signed in as',
  claims.staff_role,
  'of org',
  claims.org_id,
  `(${claims.branch_ids?.length ?? 0} branch claims)`
)

// Rebuild the cookie @supabase/ssr reads, including the chunking it applies
// past 3180 characters.
const ref = new URL(supabaseUrl).hostname.split('.')[0]
const name = `sb-${ref}-auth-token`
const encoded = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64')
const CHUNK = 3180
const Cookie = (
  encoded.length <= CHUNK
    ? [`${name}=${encoded}`]
    : Array.from({ length: Math.ceil(encoded.length / CHUNK) }, (_, i) =>
        `${name}.${i}=${encoded.slice(i * CHUNK, (i + 1) * CHUNK)}`
      )
).join('; ')

const RAJ = '00000000-0000-4000-8000-000000000401'
const SITA = '00000000-0000-4000-8000-000000000402'
const BIKASH = '00000000-0000-4000-8000-000000000403'
const ANITA = '00000000-0000-4000-8000-000000000404'

const routes = [
  ['/', ['Good to see you', 'Expiring', 'collection']],
  ['/members', ['Raj Bahadur Thapa', 'M00001', 'Sita Gurung']],
  ['/members?status=expiring', ['Raj Bahadur Thapa']],
  ['/members?status=dues', ['Sita Gurung']],
  ['/members?status=frozen', ['Anita Rai']],
  ['/members?status=expired', ['Bikash Shrestha']],
  ['/members?q=9841000003', ['Bikash Shrestha']],
  ['/members?q=sita', ['Sita Gurung']],
  ['/members/new', ['Emergency contact', 'Home branch', 'Photo']],
  [`/members/${RAJ}`, ['Raj Bahadur Thapa', 'Monthly']],
  [`/members/${SITA}`, ['Sita Gurung', 'Quarterly', 'ESW-DEMO-0002']],
  [`/members/${BIKASH}`, ['Bikash Shrestha']],
  [`/members/${ANITA}`, ['Anita Rai', 'Frozen']],
  [`/members/${SITA}/edit`, ['Sita Gurung', 'Photo']],
  ['/plans', ['Monthly', 'Quarterly', 'Annual', 'PT 10 sessions']],
  ['/payments', ['Demo Owner']],
  ['/payments?view=arrears', ['Sita Gurung', '0-30']],
  ['/staff', ['Demo Owner', 'Demo Trainer']],
  ['/check-in', ['Check-in', 'In the gym now']],
  ['/reports', ['Absent members']],
  // The seed has no attendance, so everyone active is absent by definition.
  ['/reports/absent', ['Raj Bahadur Thapa', 'Never']],
  ['/reports/absent?minDays=90', ['Absent']],
]

let failures = 0

for (const [path, expected] of routes) {
  let status = 0
  let missing = []

  try {
    const res = await fetch(BASE + path, { headers: { Cookie }, redirect: 'manual' })
    status = res.status
    if (status === 200) {
      const body = await res.text()
      missing = expected.filter((needle) => !body.includes(needle))
    }
  } catch (fetchError) {
    console.log(`FAIL  ---  ${path}  ${fetchError.message}`)
    failures++
    continue
  }

  const ok = status === 200 && missing.length === 0
  if (!ok) failures++

  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${status}  ${path}` +
      (missing.length ? `  missing: ${JSON.stringify(missing)}` : '')
  )
}

console.log(failures === 0 ? '\nAll routes pass.' : `\n${failures} route(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
