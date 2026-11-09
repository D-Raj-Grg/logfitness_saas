#!/usr/bin/env node
// Door-display QR simulator -- end-to-end proof of the QR check-in without
// hardware or a phone camera.
//
// It plays both sides: it derives the code the reader's OLED would show from
// the device's QR secret, calls member_door_check_in through PostgREST as the
// member (the app's call), then polls rfid-poll with the device key (the
// reader's call) and prints what each returned.
//
// Node 18+, built-ins + fetch only.
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=<anon/publishable key> \
//   MEMBER_TOKEN=<member access_token from the member-login function> \
//   DEVICE_SECRET_B64=<qr.secret_b64 from GET rfid-sync?qr=1> \
//   QR_ID=<qr.qr_id> \
//   DEVICE_KEY=<the reader's x-device-key> \
//   node scripts/door-qr-sim.mjs [--window-offset -2] [--payload LG1.1.12345678] [--poll-twice]
//
// --window-offset N   shift the 30 s window (0 = now; -1/+1 are accepted by the
//                     server; -2/+2 should come back invalid_code)
// --payload TEXT      send this payload instead of computing one
// --poll-twice        poll again after the first poll to show an unlock is
//                     consumed once
// --self-test         only check the published test vector, then exit
//
// Nothing is printed that is a secret except the one-time code, which expires
// in about a minute.

import { createHmac } from 'node:crypto'

/** The shared definition of the rotating code (see firmware README, "QR protocol"). */
export function doorQrCode(secret, qrId, window) {
  const mac = createHmac('sha256', secret).update(`${qrId}:${window}`).digest()
  return String(mac.readUInt32BE(0) % 100000000).padStart(8, '0')
}

function selfTest() {
  const secret = Buffer.from(Array.from({ length: 32 }, (_, i) => i))
  const got = doorQrCode(secret, 7, 56789012)
  if (got !== '06036629') {
    console.error(`test vector FAILED: expected 06036629, got ${got}`)
    process.exit(1)
  }
  console.log('test vector ok: secret 00..1f, qr_id 7, window 56789012 -> 06036629')
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}

async function main() {
  selfTest()
  if (process.argv.includes('--self-test')) return

  const need = (k) => {
    const v = process.env[k]
    if (!v) {
      console.error(`missing env ${k}`)
      process.exit(2)
    }
    return v
  }
  const url = need('SUPABASE_URL').replace(/\/$/, '')
  const anon = need('SUPABASE_ANON_KEY')
  const token = need('MEMBER_TOKEN')
  const secret = Buffer.from(need('DEVICE_SECRET_B64'), 'base64')
  const qrId = Number(need('QR_ID'))
  const deviceKey = need('DEVICE_KEY')

  const offset = Number(arg('--window-offset', '0'))
  const window = Math.floor(Date.now() / 1000 / 30) + offset
  const payload = arg('--payload', `LG1.${qrId}.${doorQrCode(secret, qrId, window)}`)
  console.log(`payload: ${payload}  (window ${window}${offset ? `, offset ${offset}` : ''})`)

  // 1. the member's phone
  const rpc = await fetch(`${url}/rest/v1/rpc/member_door_check_in`, {
    method: 'POST',
    headers: {
      apikey: anon,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_payload: payload }),
  })
  console.log(`member_door_check_in -> HTTP ${rpc.status}`)
  console.log(JSON.stringify(await rpc.json(), null, 2))

  // 2. the door reader
  const poll = async (label) => {
    const r = await fetch(`${url}/functions/v1/rfid-poll`, {
      headers: { 'x-device-key': deviceKey },
    })
    console.log(`${label} rfid-poll -> HTTP ${r.status}`)
    console.log(JSON.stringify(await r.json(), null, 2))
  }
  await poll('1st')
  if (process.argv.includes('--poll-twice')) await poll('2nd')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
