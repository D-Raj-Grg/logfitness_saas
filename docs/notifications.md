# Notifications

How Lord of Gyms sends a renewal reminder, what it costs, and how to add a
gateway. Phase 5 of `TASKS.md`.

---

## 1. Which gateway, and what it costs

`docs/PRD.md` §13 asks "Which SMS/Viber gateway for Nepal, and what is the
per-message cost at chain volume?" This is the answer as far as it can be
answered without an account, and it is deliberately not a single answer: the
gateway is a per-org setting, because every gym chain buys its own credits and
registers its own sender ID with the NTA. A message from another gym's sender ID
is the wrong message even when it arrives.

| Gateway | Endpoint | Auth | Notes |
|---|---|---|---|
| **Sparrow SMS** | `https://api.sparrowsms.com/v2/sms/` | `token` parameter | The largest Nepali provider. `token`, `from`, `to`, `text`. Answers HTTP 200 with `response_code: 200` on success, HTTP 403 with a numeric code otherwise (1002 bad token, 1012/1013 out of credits). Their docs advertise the endpoint over plain `http://`; we call it over `https://`. |
| **Aakash SMS** | `https://sms.aakashsms.com/sms/v3/send` | `auth_token` parameter | The usual second quote. `auth_token`, `to`, `text` — **no `from`**, the sender identity is fixed on the account. Answers `{"error": false, …}` on success and `{"error": true, "message": …}` on failure, both inside an HTTP 200. |
| **SMSPasal** | `https://sms.smspasal.com/smsapi/index.php` | `key` parameter | A ThemeNepal reseller. `key`, `type=text`, `contacts` (comma-separated), `senderid`, `msg`, plus an optional `campaign` and `routeid` that name a campaign and a route on the account. Answers in **plain text**, not JSON: `SMS-SHOOT-ID/<id>` when accepted, `ERR: <reason>` when not — and the refusal can arrive inside an HTTP 200. A Nepali message must go out as `type=unicode` (the adapter picks the type from the body: anything outside ASCII is unicode, and the unicode endpoint takes no `campaign`). `msg` is capped at **720 characters**, below the 1,000 a template may hold. The `senderid` is chosen per recipient: operators register sender IDs separately, so `config.sender_ntc` and `config.sender_ncell` override the gateway's own sender for NTC (984, 985, 986, 974, 975, 976) and Ncell (980, 981, 982, 970) numbers, and blank falls back to it. Smart, UTL and Hello are revoked ranges and match neither. Also publishes a credit balance at `/miscapi/<key>/getBalance/true/`. |
| **Viber Business** | `https://chatapi.viber.com/pa/send_message` | `X-Viber-Auth-Token` header | Needs a Viber Public Account. In Nepal a Viber route is normally resold rather than bought direct, and a reseller almost always exposes an SMS-shaped HTTP API instead — use the custom gateway for those. |
| **Resend** | `https://api.resend.com/emails` | `Authorization: Bearer` | Email. Used for the staff invitation. |
| **Any other** | you supply it | you supply it | The `custom_http` adapter: you give the address and name the parameters. |

### Per-message cost

Prices are **quoted, not contracted** — both providers price by volume tier and
by sender-ID type, and neither publishes a rate card that survives contact with
a sales conversation. Get a written quote before promising anything to a gym.

- Sparrow SMS advertises bulk pricing from roughly **NPR 1.40 per SMS credit**
  at small volume, falling with the size of the credit bundle.
- Aakash SMS is generally quoted a little under that at comparable volume.
- Promotional and transactional routes are priced and throttled differently, and
  reminders about money you are owed are transactional. Say so when you ask for
  a quote; a promotional route is cheaper and is the wrong one.

### What a chain actually spends

One renewal reminder at T-7, one at T-1, and one dues chase a week. Assume 400
members per branch and that a third of them renew or owe something in a given
month, at NPR 1.40 a message:

| Chain | Members | Messages/month | At NPR 1.40 |
|---|---|---|---|
| 3 branches | 1,200 | ~1,600 | ~NPR 2,250 |
| 10 branches | 4,000 | ~5,300 | ~NPR 7,400 |
| 50 branches | 20,000 | ~26,600 | ~NPR 37,300 |

**Nepali templates cost two to three times that.** A Devanagari SMS is UCS-2, so
a segment is 70 characters instead of 160, and a reminder that fits in one
English message is usually three Nepali ones. The template editor counts
segments rather than characters for exactly this reason.

---

## 2. How it works

```
pg_cron 'notifications-enqueue'   02:30 Kathmandu, nightly
  enqueue_renewal_reminders()     memberships ending in N days
  enqueue_dues_reminders()        invoices with a balance older than N days
  enqueue_birthday_greetings()    date_of_birth matching the org's today
        │  writes rendered rows into notification_messages, status 'queued'
        ▼
pg_cron 'notifications-outbox'    every minute
  reap_notification_responses()   reads last minute's net._http_response
  send_notification_batch()       claims due rows, calls the gateway via pg_net
```

Nothing runs in the Next.js app. The whole pipeline is Postgres, which is what
lets the Flutter app and any future integration reuse it, and — the reason it
was built this way — what avoids needing a Supabase project secret. Project
secrets can only be set from the dashboard or a logged-in CLI, and that gap is
what left the `qr-token` Edge Function answering 503 until its key moved into
Vault, and what still leaves `push-fanout`'s FCM path unverified. Gateway tokens
live in `supabase_vault`, written by an owner from `/settings/notifications`
through `set_notification_credential`, and readable only by the sender.

### The tables

| Table | What it holds |
|---|---|
| `notification_providers` | One active gateway per channel per org. Owner-only. Holds a Vault reference, never a token. |
| `notification_rules` | Whether, when and how often. T-7 and T-1 are two rows of one rule with different `offset_days`. |
| `notification_templates` | The gym's own wording, per event, channel and locale. Absent means the built-in is used. |
| `notification_messages` | The outbox *and* the delivery log. One table, so there is one answer to "was this member told". |

### Things worth knowing

- **A message is rendered at enqueue time, not send time.** Editing a template
  does not retroactively change what a member was told.
- **`skipped` is not a failure.** It means the gym deliberately did not send:
  no gateway on that channel, no token, an opted-out member, or a phone number
  that cannot be delivered to. It is not retried automatically and it is not
  shown in red.
- **Idempotency is the `dedupe_key`.** `renewal:<membership_id>:<offset_days>`,
  `dues:<member_id>:<date>`, `birthday:<member_id>:<year>`, unique per org. A
  sweep that runs twice inserts once.
- **Phone numbers are normalised at enqueue time, not in the column.**
  `members.phone` is free text under `unique (org_id, phone)`, so normalising in
  place could collide two real members. `normalise_msisdn` produces the bare ten
  digits the gateways want, or null — and null becomes a visible `skipped` row
  rather than silence.
- **Delivery is at-least-once, not exactly-once.** `net.http_request_queue` and
  `net._http_response` are UNLOGGED, so a crash, compute resize or Postgres
  upgrade truncates them. A row left `sending` with no response for ten minutes
  is retried, which means a member can rarely receive the same message twice.
  The alternative — never retrying — silently drops reminders, which is worse.
- **A member can opt out.** `members.notifications_opt_out`, on the member edit
  form. Every enqueue job checks it, and so does the manual send below — and
  since `20260912110000`, so does `enqueue_notification` itself. That last one
  matters more than it reads: until then the check lived only in
  `send_member_notification`, so "not overridable" was a property of the
  wrapper rather than of the outbox, and any staff caller who went one function
  lower down skipped it. `enqueue_notification` now also refuses a role outside
  `{owner, manager, front_desk}`, which is what `member_message_target` had
  always enforced at the front door.

### Sending by hand

Everything above is a schedule. **Send SMS** — on the member profile header and
in the member list's row menu — is the other half: one message, to one member,
now.

```
member_notification_preview(member, event)   what it would say, and why it would not go
send_member_notification(member, event, body)
  member_message_target()                    role, org, branch, archived, opt-out, template vars
  enqueue_notification()                     the same single INSERT into the outbox
```

- **Owner, manager and front desk.** A trainer is refused by
  `member_message_target`, which is also where the branch check lives: a
  manager of Thamel cannot text a Hetauda member.
- **Four reasons.** Dues, renewal and birthday render the gym's own template
  with this member's real figures — the same sentence the nightly sweep would
  have produced — and `custom_message` is free text with no template at all.
  `staff_invite` and `test_message` are refused: neither is addressed to a
  member.
- **The desk may edit the wording, and what it sends is what the log stores.**
  The body travels with the send rather than being re-rendered, so the message
  and the record cannot disagree. Editing here never touches the gym's template.
- **Opt-out is not overridable.** A member who asked not to be texted is
  refused with a sentence rather than skipped quietly.
- **A double click costs nothing.** A manual send has no deterministic dedupe
  key, so the guard is a window instead: the same reason to the same member
  inside two minutes is refused.
- **`created_by` says who pressed Send.** Null for anything a sweep raised. The
  delivery log shows the name; the profile's Messages tab shows the same rows
  for one member.

---

## 3. Adding a gateway

Two `case` arms and one enum value. Both functions are pure — no network, no
writes — so the SQL gate asserts them directly against real provider payloads.

1. Add the value to `public.notification_provider`.
2. Add an arm to `notification_request(...)`, returning
   `{method, url, params | body, headers}`. **`method` must be `GET` or `POST`**:
   pg_net 0.20 raises unless a POST's Content-Type is exactly
   `application/json`, so a form-encoded gateway has to go out as a GET with
   `params`, which pg_net urlencodes itself. There is no PUT or PATCH.
3. Add an arm to `notification_response_ok(...)`, returning
   `{ok, message_id, error}`. Read the body, not just the status: Sparrow and
   Aakash both report failures inside an HTTP 200.
4. Add it to `CHOICES` in `components/notifications/provider-form.tsx`.
5. Add a case to `supabase/tests/notifications.sql`.

A gateway that publishes a credit balance gets one more arm, in
`notification_balance_url(...)`, and its enum value added to `BALANCE_CAPABLE`
in the provider form. The balance is a two-step for the same reason a send is:
the API key lives in Vault, so `request_notification_gateway_balance` makes the
call from inside the database and `read_notification_gateway_balance` collects
the reply, which is parked on the provider row (`balance`, `balance_error`,
`balance_checked_at`). The button polls the second one; the first is throttled
to one live request per gateway per 20 seconds. `notification_balance_url`
builds a URL with the key inside it, so — like `notification_credential` — no
client role may call it.

Until then, `custom_http` covers anything with an HTTP API without new code:
the owner supplies the address and a JSON template using `{{token}}`, `{{to}}`,
`{{text}}` and `{{sender}}`.

---

## 4. What has and has not been proven

**Proven, against live traffic**, before any of this was committed: the whole
pipeline end to end through a real HTTPS endpoint — request shaping, TLS, pg_net
dispatch, the response reaper, a 200 marked `sent`, a 500 retried with backoff,
a DNS failure recorded as `Couldn't resolve host name`, and a channel with no
gateway marked `skipped` rather than failed.

**Not proven:** that Sparrow, Aakash, SMSPasal, Viber or Resend accept these
payloads.
Only an account can establish that, and each adapter is written from published
documentation. Connect an account and use the **Send test** button on
`/settings/notifications` before relying on any of them. `TASKS.md` says the
same thing, per provider.
