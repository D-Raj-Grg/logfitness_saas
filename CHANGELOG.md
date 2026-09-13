# Changelog

What changed in the Lord of Gyms staff console, newest first.

No release has been cut yet, so entries are grouped by the day the work landed
on `main` rather than by version. Each one names the commit, because the commit
messages carry the reasoning and this file only carries the outcome.

Two conventions worth knowing while reading:

- **Security** entries describe holes that existed in this repository's history
  and are now closed. Nothing here shipped to a paying gym; the project has been
  in Phase 0-2 development throughout.
- Anything under **Database** changes the Supabase project. Migrations live in
  `supabase/migrations/` and are applied through the Supabase MCP, so they are
  already live by the time the commit lands.

---

## 2026-09-13 — The dashboard says something, and the phone stops scrolling sideways

### Added

- **Three charts under the dashboard tiles.** The tiles answer "what is true
  right now" and nothing answered "which way is this going": revenue over the
  last 30 days, footfall over the last 14, and membership movement over six
  months, each linking into the report that holds the detail. Revenue plots
  **net**, matching the tile above it, because a day with a large refund on it
  is exactly the day the dashboard should not be showing a record. Attendance is
  bars rather than a line — a closed day should read as a gap, not as a line
  sagging through zero — and carries check-ins beside distinct people, since one
  member training twice is two visits and one person. Movement stacks new and
  renewed above the axis and expiries below it, so a month where the gym shrank
  looks like one however good the sales number was on its own.
- **Days with no rows are drawn as zero**, not dropped. A gap the line runs
  straight through flatters a bad week.
- Each panel is its own Suspense boundary — three reports at three speeds, and
  the tiles never wait on any of them — and recharts loads on demand, as it
  already did on `/reports/attendance`. It is the heaviest dependency in the
  console and the dashboard is the first screen every shift opens.
- Owners and managers only, off the same rule the reports read. A trainer's
  dashboard is unchanged: who is in, who is about to lapse, no takings.

### Fixed

- **The whole console scrolled sideways on a phone.** `SidebarInset` is a flex
  child with `w-full` and no `min-w-0`, so its automatic minimum size was its
  content's min-content width. Every table that scrolls inside its own box was
  therefore setting the minimum width of the page instead: the member profile's
  message history at 860px dragged the header, the dues banner and everything
  else off to the left with it. `min-w-0` on the inset, the shell's `main` and
  `header`, and on the profile's two columns — the tables now scroll in their
  own box, as they were always meant to.
- **The delivery log's message column ran under the Status badge.** `TableCell`
  is `whitespace-nowrap` by default, so the two-line clamp had nothing to wrap
  and 160 characters of SMS ran straight across the column boundary. The table
  is `table-fixed` now with stated column widths, the body wraps and clamps at
  two lines with the full text on hover, and Status and Actions are wide enough
  for "Not sent · Send again".
- **The mobile menu stayed open after you chose something.** The sidebar is a
  sheet over the page on a phone, so tapping Members left the menu covering the
  screen that had just loaded. It closes on tap now, on touch only — the desktop
  sidebar is permanent and stays put.

### Changed

- **The member profile is laid out for the phone it is opened on.** Stacked, the
  membership panel comes first: renewing a plan or taking a payment is why the
  desk opened the record, and it was a scroll past five tabs of history. It
  returns to the right-hand column on a wide screen, where it now follows the
  scroll. The header stacks, the small desk-sized buttons get a taller hit area
  on touch, the details grid drops to two columns before three, and the five
  history tabs scroll sideways rather than wrapping into a second row of pills.
- **Chart colours are the brand's.** `--chart-1` through `--chart-5` were
  greyscale placeholders from the scaffold while the product's own colour is
  emerald. They are now five hues anchored on it and spaced around the circle
  so neighbouring series stay apart for red-green colour blindness, with
  lightness rather than hue shifting in the dark theme so a series keeps its
  identity across both.

### Security

- **`enqueue_notification` was the widest door in the notification surface.**
  SECURITY DEFINER, granted to `authenticated`, and its only role test was
  `jwt_is_staff()` — every other guard in the body was conditional on an
  argument that defaults to null. Called with its four required arguments and
  nothing else, a trainer could send, `members.notifications_opt_out` was never
  consulted (the opt-out `docs/notifications.md` calls "not overridable" was
  overridable one function lower down), and the row landed with a null
  `branch_id`, which the read policy treats as org-wide. Neither gap was
  reachable through the console or the Flutter app, but PostgREST exposes the
  function to any staff JWT whatever the client chooses to call, so the client's
  restraint was never the control. Both checks are transcribed from the wrapper
  that already had them. Nothing that worked before stops working: the nightly
  sweeps insert into `notification_messages` directly, and the two callers are
  themselves SECURITY DEFINER, which does not change whose JWT the `jwt_*`
  helpers read. Migration
  `20260912110000_enqueue_notification_role_and_consent.sql`, applied through
  the MCP and mirrored by hand; regression tests in
  `supabase/tests/notifications.sql` cover the trainer, the opted-out member and
  the branch-less row.

## 2026-09-12 — The walk-in gets a text

Phase 5's three sweeps are all about a member: a membership ending, money owed,
a birthday. The person who walked in, asked what a month costs and left was the
one contact the product held a mobile number for and never used. Two new events
close that, and the visitor log gets the same by-hand send the member profile
got this morning.

### Added

- **A welcome the moment a walk-in is logged.** Not a sweep — an `after insert`
  trigger on `visitors`, so the message is with the outbox worker within the
  minute. "Thanks for coming in" arriving at 02:30 the following morning is a
  different, worse message. The trigger swallows its own errors and logs a
  warning: the visit is the product and the SMS is a courtesy, so a null
  template or a mangled variable cannot take the counter down.
- **A follow-up a few days later**, as a fourth nightly sweep inside
  `enqueue_notifications()`. Three days after the visit by default, only for
  visitors still new or contacted — converted is a member now and gets a
  member's messages, and "not joining" said no. Keyed on the visitor id alone,
  so a gym that moves the offset from three days to five does not text somebody
  who already had one.
- **Both are switches in Settings → Reminders**, beside the renewal, dues and
  birthday rules, with the follow-up's own send time. The welcome shows "Goes
  out within a minute" rather than a time picker, because there is no hour to
  choose.
- **Both messages are editable wording**, in the same editor as the member
  templates, with English and Nepali built-ins and `{{visitor_name}}`,
  `{{gym_name}}`, `{{branch_name}}`, `{{plan_name}}` and `{{visited_on}}`
  bound. Neither default mentions the plan: a walk-in who asked about nothing in
  particular has none, and a sentence with a hole in it reads worse than one
  that never promised the detail.
- **Two by-hand sends on the visitor row.** **Send welcome SMS** is one click
  with no dialog — the gym's own wording, rendered in Postgres, for a desk
  clearing a morning's callbacks. **Send message…** opens the member dialog's
  twin: welcome, follow-up or free text, a preview that can be edited before it
  goes, the recipient's normalised number, and a GSM/UCS-2 segment count because
  segments are what turn into money. Owner, manager and front desk; a trainer
  logs a walk-in and does not text one.
- **`notification_messages.visitor_id`**, so "has this walk-in been told
  anything" has an answer, and the delivery log names both new reasons.

### Fixed

- **A phone too short to store made the welcome vanish.** `visitors.phone`
  accepts anything from 1 to 30 characters — the desk types what it was given —
  while `to_address` carries a CHECK of 3 to 254. A visitor logged as "12"
  therefore raised a CHECK violation inside the trigger, which the trigger's own
  handler swallowed: no row, no warning, and a walk-in the log claimed had never
  been texted for a reason nobody could see. An unusable number now falls back
  to `unknown` and lands as `skipped` with the reason on it. Caught by the new
  gate, not in production.
- **A back-dated visit was thanked for coming in today.** `visited_on` is
  editable precisely so the desk can log yesterday evening's enquiry this
  morning, and the trigger fired on those inserts too. The automatic welcome is
  now the day's own event; a back-dated row is left alone, and the desk can
  still send one by hand, which is a decision rather than an accident.

### Database

Four migrations, applied and mirrored in `supabase/migrations/`: the two enum
values alone (Postgres refuses to use a value added by the same transaction),
the column, trigger, sweep, templates, rules and the three RPCs, then the two
corrections above. `enqueue_notification` was dropped and rebuilt to take
`p_visitor_id` — a parameter cannot be added by `create or replace`, and a
nine-argument function sitting beside a ten-argument one makes every named call
ambiguous — so every send in the system still passes through exactly one INSERT
into the outbox. `visitor_message_target` is internal and callable by no client
role; it refuses a trainer, another gym's visitor, a branch the sender does not
cover, and a visitor who has already joined. `get_advisors(security)` reports no
new findings.

Gate: `supabase/tests/visitor_messages.sql`, wired into `npm run db:test` —
the disabled rule queueing nothing, the trigger's row and dedupe key, the
unusable number, the back-dated skip, sweep idempotency across a changed offset,
converted and lost excluded, the trainer, cross-branch and cross-org refusals,
the two-minute double-click guard, and the grant assertion on
`visitor_message_target`.

### Verified

Both screens walked in the browser against the live SMSPasal gateway: the row
menu, the dialog rendering a real visitor's welcome at 143 characters and one
segment, the two new checkboxes arriving unticked, and both template cards with
their variables and previews. No SMS was sent to a real visitor's handset.

### Known limits

- **Both automatic rules ship disabled**, unlike the member rules, which seed
  enabled. Those shipped with the feature; these arrive at gyms that already
  have a live gateway and a full visitor log, and switching them on would spend
  an owner's credit on a decision they never made.
- **A visitor cannot opt out.** `members.notifications_opt_out` has no visitor
  equivalent and this work did not add one: a walk-in gave the desk their number
  minutes ago for exactly this. Someone who asks not to be contacted is marked
  "not joining", which takes them out of the follow-up sweep.
- **The follow-up's offset is not editable on screen**, only its enabled state
  and send time — the same limit every other rule has had since Phase 5, because
  `offset_days` is part of the rule's identity.

## 2026-09-12 — A gateway a Nepali gym can actually send from

The notification pipeline shipped on 09-09 with four adapters written from
published documentation and no account behind any of them. A gym account now
exists, and the first real SMS left the system today — which is also how three
silent bugs surfaced, one of them a year-zero defect that had made *every*
gateway unsavable since the settings screen was built.

### Added

- **SMSPasal** (sms.smspasal.com, a ThemeNepal reseller) as a fourth SMS
  gateway. One GET with the API key as an ordinary parameter, and a plain-text
  reply rather than JSON: `SMS-SHOOT-ID/<id>` when accepted, `ERR: <reason>`
  when not — and the refusal arrives inside an HTTP 200, so the body is the
  verdict and the status code is not. The account's optional `campaign` and
  `routeid` live in `notification_providers.config` and are omitted from the
  request entirely when blank, because `campaign=` with no value is not the same
  request as no campaign at all.
- **A sender ID per carrier.** Operators register sender IDs separately and a
  reseller routinely ends up with different words on each — this account sends
  as `smsbit` on NTC and `TN_ALERT` on Ncell — while the API takes exactly one
  `senderid` per request. `nepal_mobile_carrier()` reads the operator off the
  recipient's own number (digits only, last ten, so `+977 984-1234567` and
  `9841234567` are the same number) and the adapter picks `config.sender_ntc` or
  `config.sender_ncell`, falling back to the gateway's own sender. Smart, UTL and
  Hello are revoked licences, not a third case: 961, 962, 988, 972 and 963 match
  nothing and take the fallback.
- **Remaining credits, on demand.** The API key lives in Vault and no client
  role can read it, so the console cannot call the gateway itself: the database
  makes the call with pg_net and a second call collects the reply, parked on the
  provider row. A **Check balance** button fires the first and polls the second.
  Throttled to one live request per gateway per 20 seconds, and
  `notification_balance_url` — which builds a URL with the key inside it — is
  callable by no client role at all, exactly where `notification_credential`
  stands.
- **Channel tabs** on `/settings/notifications`. Three stacked gateway cards
  became SMS / Viber / Email tabs, each tab carrying its own state — Connected,
  Paused, or Not set up — so the state of the other two channels is legible
  without a click.
- **A saved token looks saved.** The write-only token field is replaced by a
  masked pill and a **Saved** badge once a key is stored, with **Replace** to
  swap it back for an input, and a gateway with no key carries a **No token yet**
  badge next to Connected. Nothing is ever echoed back — the mask is fixed-width
  dots, not the key's length.
- **The delivery log keeps itself current.** A message sits in `sending` for up
  to a minute — the outbox cron hands it to the gateway on one tick and reads the
  reply on the next — so the row that matters is precisely the one that is stale
  by the time the page renders. While anything on screen is queued or going out,
  the table re-fetches every eight seconds and on tab focus, stops the moment
  nothing is in flight, and gives up after fifteen minutes with a "check again"
  link rather than polling a stuck message all afternoon.
- **Colour on the statuses.** Green delivered, blue going out, amber waiting, red
  failed, grey for cancelled and not-sent — with a dot as well as a colour, so it
  still reads without colour. Grey for those last two is deliberate: "not sent"
  is the gym choosing not to send or a number nobody can deliver to, and red
  would send someone hunting a gateway fault that does not exist.

- **Send one member a message, now.** Everything the pipeline did was a
  schedule: a member standing at the desk owing Rs 3,400 was outside it
  entirely, and a text sent from someone's own handset reached no log at all, so
  "was this member told" had no answer for the one message that mattered most.
  **Send SMS** now sits on the member profile beside Edit and in the member
  list's row menu. The dialog composes nothing itself — the wording is rendered
  in Postgres from the gym's own template and this member's real figures, the
  same sentence the 02:30 sweep would have produced — and the desk may edit it
  before sending, because the body stored in the log is the body that went out.
  Dues, renewal, birthday, and a free-text `custom_message`: a new event with no
  default wording and no slot in the template editor, exactly where
  `test_message` stands.
- **Every reason it would not go is on screen before the button is.** The same
  preview call reports an opted-out member, a number that will not normalise and
  a channel with no gateway, and Send is disabled carrying that sentence rather
  than offered and then refused. Consent is not overridable: `notifications_opt_out`
  stops a manual send the way it skips a sweep.
- **The log answers "who texted this member".** `notification_messages.created_by`
  records who pressed Send — null for anything a sweep raised — and the delivery
  log shows the name under the reason. The member profile gains a **Messages**
  tab reading the same rows, so the history sits where the member is rather than
  only in the org-wide log.

### Fixed

- **Every gateway save failed silently, and always had.** `formData.get()`
  returns null for an input the current gateway does not render, and the optional
  fields were `.optional()`, which in zod v4 rejects null. So a save was refused
  over `configJson` — a field only the custom-HTTP gateway shows — and the field
  error had nowhere on screen to appear: the button did nothing, wrote nothing,
  and said nothing. Sparrow and Aakash were never savable either, and the
  template editor's `subject` had the same hole. Optional fields are now
  `.nullish()`, a parse failure returns a readable summary as well as per-field
  text, and every gateway action raises a toast, so a silent outcome is no longer
  possible on that screen.
- **The delivery log's summary chips rendered `: 2` with no word.** The label
  maps were exported from `notification-filters.tsx`, a `'use client'` module: a
  Server Component importing a plain constant across that boundary gets the
  client reference rather than the object, so every lookup was undefined. The
  filter dropdowns read them correctly, which is why it went unnoticed. Labels
  now live in `lib/notifications/labels.ts`. This is the second time this
  boundary has bitten — `e3c843c` moved the pagination constants for the same
  reason — and any other constant exported from a client module and read on the
  server will fail the same silent way.
- **A Nepali reminder would have arrived as boxes.** `type=text` is the GSM
  alphabet; SMSPasal has a separate `type=unicode` for Devanagari, and the
  product ships Nepali templates. Caught in review before it sent anything: the
  type is now derived from the message body, and the unicode endpoint — which
  documents no campaign — is sent none.
- **The balance reaper read a missing row as a present one.** It tested the
  record for null, which is also true of a found row whose columns happen to be
  null. It tests `FOUND` now, and a response carrying no status code is an error
  rather than falling through to the body check.

### Database

Six migrations, all applied and mirrored in `supabase/migrations/`: the
`smspasal_sms` enum value alone (Postgres refuses to use a value added by the
same transaction), the request/response arms plus the four balance columns and
their two RPCs, the unicode and reaper corrections, `nepal_mobile_carrier()`
with the carrier-aware sender, the `custom_message` event (alone again, for the
same enum reason), and the manual send itself.

The manual send adds three functions and one column. `member_message_target` is
internal — callable by no client role — and holds every check in one place:
owner, manager or front desk; the member is in this org, not archived, and at a
branch the sender covers; plus the template variables, read from
`member_overview` so what a reminder quotes has one source rather than two.
`member_notification_preview` renders what would be sent and reports what would
stop it. `send_member_notification` refuses an opted-out member, a channel with
no gateway, a blank custom body and the two events not addressed to a member at
all — then delegates the write to `enqueue_notification`, so there is still
exactly one INSERT into the outbox and normalisation, the `skipped` row and the
dedupe key are not reimplemented beside it. A manual send has no deterministic
dedupe key, so a double click is caught by a two-minute window instead.
`get_advisors(security)` reports no new findings — the balance RPCs and the two
callable send RPCs are SECURITY DEFINER with hand-rolled checks, standing
exactly where the credential RPCs do, and the guard behind them is granted to
nobody.

Gate: `supabase/tests/notifications.sql` grew the SMSPasal request shape with and
without the account ids, the three plain-text response shapes, Devanagari
selecting unicode, the carrier prefix table, sender selection per carrier and its
fallback, cross-org denial on both balance RPCs, and the grant assertion on
`notification_balance_url`. It also grew a manual-send block: the desk sends and
the row lands rendered with its author, a trainer is refused and cannot even
preview, the desk is refused a member at a branch it does not cover, another gym
is refused outright, an opted-out member is refused, a blank custom message is
refused, a second send inside the window is refused, and a member whose number
will not normalise produces one `skipped` row that says so.

### Performance

- **Every console screen streams** (`daf5345`). There was no `loading.tsx`,
  `error.tsx` or `not-found.tsx` anywhere, and all twenty pages under `(app)`
  awaited their data at the top level, so TTFB was total server work and the
  screen stayed blank until the slowest query landed. Page bodies moved into
  Suspense-wrapped children on the dashboard, members, payments and all five
  reports, each boundary re-keyed on its query so changing a filter swaps in a
  skeleton rather than stranding the previous result. Skeletons mirror the
  components they stand in for — same grid, same column count — so nothing
  shifts when the data arrives. `getCurrentStaff` and `listBranches` are wrapped
  in React `cache()`: a single `/members` request was issuing `current_staff`
  twice and `listBranches` three times.

### Verified

A real SMS left the system through SMSPasal and arrived on a handset. The log
row carries `provider_status` 200 and the gateway's shoot ID, and the balance
call answered live with the account's own route and credits. Both were driven
through the browser, not curl.

### Known limits

- **Delivered means the gateway accepted it**, not that a handset received it.
  SMSPasal publishes a DLR API keyed by the shoot ID already stored; it is not
  wired up, so the log cannot yet distinguish accepted from delivered.
- **The NTC sender is unproven.** The test send went to an Ncell number, and
  `smsbit` is not selectable as a sender in the account's own panel, which
  suggests the reseller's route substitutes it rather than accepting it on the
  request. If NTC comes back `ERR: INVALID SENDER ID`, clearing the NTC field
  falls back to the registered sender.
- **SMSPasal caps a message at 720 characters** while a template may hold 1000.
  An over-long message is refused by the gateway and lands as `ERR:` in the log
  rather than being caught at save time.

## 2026-09-11 — The list the front desk actually reads

### Added

- **The member list opens on the entry feed** (`33f4ca8`), newest member code
  first, instead of A-Z — the person just registered was landing somewhere in
  the middle. Code, Name, Plan and Dues sort from their headers, sorting is URL
  state so a sorted view is a link, and every order tiebreaks on `member_code`
  so a row cannot appear on two pages while another appears on none.
- **A serial number that continues across pagination**, and a per-row action
  menu: quick edit, full edit, the membership forms, check in, and the
  archive/restore/delete confirmations shared with the profile.
- Quick edit writes through a narrow `quickUpdateMember` rather than
  `updateMember`: the list reads `member_overview`, which does not carry the
  address, notes, date of birth or emergency contact, and a full-record update
  from a dialog that cannot show those fields would blank them. The membership
  items are links to the profile with `?action=`, not dialogs on the row — they
  need that member's memberships, invoices, payments and the branch's plans,
  which the profile already loads and a row would have to fetch twenty-five
  times a page.

## 2026-09-10 — What the member reads on the paper

### Added

- **A waived joining fee is visible** (`726c95c`). A member who paid no
  registration fee had no way to see that one applied and was not taken, and the
  amount was recorded nowhere — not recoverable afterwards, since the plan may
  have been repriced. It is now written at the point of sale
  (`memberships.signup_fee_waived_paisa`), with `orgs.standard_signup_fee_paisa`
  as the gym's list fee so a tier sold as "joining fee waived" has something to
  strike out. The waiver is a memo throughout: outside `price_paisa`, outside the
  invoice subtotal, outside every revenue report. Gate:
  `supabase/tests/waived_signup_fee.sql`.

### Changed

- **The invoice and receipt were redesigned, and a discount now explains
  itself** (`5a00b21`). The waived-fee lines printed a contradiction — "Joining
  fee NPR 500 / charged once, on the first membership", for a fee that was never
  charged. The gym owner's verdict was that "waived" is a word his customers do
  not understand: the fee now shows and comes back off with a minus, the way a
  discount reads, with a plain line underneath saying why. The discount had the
  opposite problem — honest but invisible, a grey row with no reason attached
  anywhere in the system. `discount_reason` is now an enum with an `other`
  escape carrying a note, stored on both memberships and invoices, immutable
  once sold, and `renew_membership` refuses money coming off without one. The
  table constraints are `NOT VALID` on purpose: discounted rows predate the
  column, and back-filling them with a reason nobody chose would be inventing a
  financial record.

## 2026-09-09 — The reminder that goes out on its own

### Added

- **Notifications**. Renewal reminders at T-7 and T-1, a dues chase, and a
  birthday greeting, worked out once a night and sent over SMS, Viber or email.
  Every number the console already computed — expiring in seven days, arrears
  with age buckets — was a screen somebody had to remember to open. Now it
  leaves on its own.
- **`/notifications`**, the delivery log: what was sent, to whom, why, and what
  the gateway said back, with filters and a resend. The outbox and the log are
  one table, so there is exactly one answer to "was this member told".
- **`/settings/notifications`** (owner only): connect a gateway, choose when
  reminders go out, and edit what they say. The wording editor previews the
  message and counts SMS segments rather than characters, because a Nepali
  reminder is UCS-2 and bills two to three times an English one.
- **A member can say no.** `members.notifications_opt_out`, on the member edit
  form, checked by every sweep. The PRD does not mention consent; sending
  automated SMS with no way to stop is not shippable.
- **Staff invitations are emailed.** Previously an invited person was told, by
  whoever invited them, to go and sign up — nothing was sent. With no email
  gateway configured the message lands as `skipped` and the invite behaves
  exactly as before.

### Database

- Four tables — `notification_providers`, `notification_rules`,
  `notification_templates`, `notification_messages` — all RLS-enabled with
  cross-tenant negative tests, plus `members.notifications_opt_out` and an
  expression index for the birthday sweep. Gate:
  `supabase/tests/notifications.sql`.
- **Sending lives in Postgres**, on `pg_net` and `pg_cron`, not in an Edge
  Function. An Edge Function needs a Supabase project secret, and a project
  secret can only be set from the dashboard or a logged-in CLI — the wall that
  left `qr-token` answering 503 and still leaves `push-fanout`'s FCM path
  unverified. Gateway tokens live per-org in `supabase_vault`, written by an
  owner and readable only by the sender. Nothing is provisioned by hand, which
  is what let the whole path be proven against live HTTPS traffic before it was
  committed: a 200 marked sent, a 500 retried with backoff, a DNS failure
  recorded, a missing gateway skipped rather than failed.
- The gateway abstraction is two pure functions, `notification_request` and
  `notification_response_ok`. Adding a provider is two `case` arms.

### Security

- `get_advisors(security)` caught `resolve_notification_template` shipping as a
  SECURITY DEFINER that took an org id — any signed-in user could have read any
  gym's message wording through `/rest/v1/rpc`. The gate had tested the table's
  RLS and missed the RPC that stepped around it. Fixed to SECURITY INVOKER with
  an explicit org check, and the gate now covers it.
- Two trigger functions were `anon`-callable SECURITY DEFINER functions, a new
  advisory category for this project rather than one of the standing accepted
  ones. EXECUTE revoked.

### Known limits

- The Sparrow, Aakash, Viber and Resend adapters are written from published
  documentation and have never been run against a real account. The
  echo-endpoint test proves the plumbing, not the provider's acceptance.
- Delivery is at-least-once: pg_net's queue and response tables are UNLOGGED,
  so a crash can lose a response and force a retry. A member may, rarely,
  receive the same message twice.

## 2026-09-07 — The chain layer

Phase 3. The console could only ever show one branch at a time; it now shows a
chain, and a manager who runs three branches can finally ask it for their own
total.

### Added

- **One branch scope the whole console reads** (`6dbd2dc`, `992eaf5`). Resolved
  once server-side from a `?branch=` parameter plus a cookie that remembers the
  last choice, so a drill-down is an ordinary link and a link is shareable. The
  switcher sits in the app shell and does not render for a single-branch desk.
- **An HQ dashboard** (`2bd2911`). `org_snapshot` answers for every branch in
  scope in one round trip, where the dashboard used to issue one collection
  query per branch. Every number in the branch table links into the screen that
  already shows that detail -- no new detail pages were built.
- **`/branches`** (`e4b1f0a`), owner-only: list, create, edit, deactivate.
- **Role and branch reassignment** (`fdd3156`), so moving a front-desk hire to
  another branch no longer means deactivating them and starting over.
- **Four chain reports** (`eb31a7a`, `58fb6b4`, `eda875c`): revenue by branch,
  period and method; new members, renewals and churn; the attendance trend; and
  the plan mix.
- **CSV export on all seven report screens** (`37d0835`). The handler re-runs
  the report as the caller through the same cookie-bound client the page used,
  so RLS applies to the file exactly as it applied to the screen, and the file
  is the whole report rather than the page on screen.

### Security

- **A manager could promote someone into a peer manager** (`f40f7a9`). The RLS
  update policy on `staff` restricted a manager only to `role <> 'owner'`, so a
  manager could raise any front desk or trainer they covered to `manager` by
  calling PostgREST directly -- the Flutter app, curl, anything that was not the
  Server Action, which correctly refused it. The invite policy already had the
  right ceiling; the update path never got one. It now lives in
  `guard_staff_assignment()`, alongside guards that the last active owner cannot
  be demoted or deactivated and that nobody changes their own role.
- **`branches` still carried a delete policy** (`e4b1f0a`). Dropped. Nothing in
  the application ever used it.

### Fixed

- **The dashboard lied to multi-branch managers** (`e41c4ac`). Every report
  function took a single branch id, so a manager covering three branches was
  shown the first one with no indication the others were missing. They take
  `p_branch_ids uuid[]` now.
- **Check-in broke for single-branch desks** (`992eaf5`), briefly, during this
  phase: routing the page through the new scope made the write branch null for
  exactly the commonest case, and the desk was told "You do not work at that
  branch" for any member whose home branch differed from theirs.
- **A cross-branch renewal counted as a new member** (`3e2d3f8`), and the member
  who came back at another branch counted as churn. Sequence and churn are facts
  about a member's whole history, not about the branch in view.
- **A cancelled membership was counted on its old end date** (`3e2d3f8`), so a
  year-long plan cancelled in month two surfaced ten months later in a month
  where nothing had happened -- or never.
- **A mistyped date in the URL returned a 500** (`73fbd3f`). `2026-13-01` is
  shaped like a date; Postgres does not roll it over, it raises.

### Database

Six migrations: the branch-list report signatures, `org_snapshot`, the branch
write policies, the staff assignment guard and its manager ceiling, and the four
report functions. Gate: `supabase/tests/chain_layer.sql`.

### Verified

Statically, and against the live database — there is no seeded login on this
machine, so nothing here was clicked through in a browser.

`revenue_report` was reconciled against `daily_collection` on every branch-day
of real data, refund and reversal days included, and `net = gross − refunds −
reversals` held on every row. `org_snapshot`'s totals equal the sum of its
branch rows across all five columns. `attendance_trend` agrees with
`attendance_day_summary`. An empty `uuid[]` means no branches rather than every
branch — the mistake that would quietly show a manager the whole chain. All
twelve functions are `security invoker` bar the one trigger, and `anon` can
execute none of them.

What that leaves untested: the two URL controls composing on screen, the chart,
and the numbers as a person actually reads them.

`npm run db:test` now names all twelve gate files. It named four of nine before,
which is worse than a script that cannot run: it looked like it had passed.

---

## 2026-09-08 — The walk-in who is not a member yet

### Added

- **Visitors** (`008fb45`). A log for everyone who walked in without a
  membership: the enquiry who asked what a month costs, and the guest who
  trained for a day. Name, mobile, the org's own today, branch, kind, one note,
  the plan they asked about, and a status of new / contacted / converted / lost.
  It replaces the paper pad the callback used to die on. Every role can log one,
  trainers included — a walk-in asks whoever is standing there.
- **Register a visitor as a member** (`008fb45`). The row's Register button
  opens the registration form with the name and mobile already filled, and marks
  the visitor converted once the member exists. `converted` is not a status
  anyone can pick: `convert_visitor()` sets it after `register_member()` has
  returned a member, the check constraint refuses it without one, and it cannot
  happen twice.
- **Rows per page on the member and visitor lists** (`008fb45`). 10, 25, 50 or
  100, in the URL like every other filter. `/members` had accepted a `pageSize`
  parameter since it was built with no way to set one.

### Changed

- `Pagination` moved from `components/members/` to `components/app/` and takes a
  `basePath`, because two lists now use it (`008fb45`).
- The visitor list is paged rather than capped. It briefly returned the newest
  200 rows and silently dropped the rest (`008fb45`).

### Fixed

- **A page boundary that moved under the desk** (`4a97afe`). The member list
  sorted by name and the attendance log by check-in time, and neither is unique
  — names repeat, and two people can be checked in at the same instant. Postgres
  guarantees nothing about tied rows across separate `LIMIT`/`OFFSET` queries,
  so a member could appear on page one and page two while another appeared on
  neither, which reads at the desk as a record that has gone missing. Both lists
  now end on `id`, as the visitor list does.
- Following up a visitor logged at another branch (`008fb45`). Reads are
  org-wide but the update policy was not, so a desk could see an out-of-branch
  enquiry, register the member, and then fail to mark the row — silently,
  because the Server Action swallows a failed link rather than throwing away a
  completed registration. Logging stays branch-scoped; following up does not.

### Database

- `visitors`, the `visitor_kind` and `visitor_status` enums, RLS, an audit
  trigger, and `set_visitor_defaults()` filling `visited_on` from
  `org_today(org_id)` and `created_by` from the JWT (`20260908110100`).
- Visitor phone length raised to 32 to match every other phone in the product
  (`20260908110150`).
- Visitor follow-up widened from branch-scoped to org-wide for staff
  (`20260908110200`), and `convert_visitor()`'s refusal message reworded to
  match (`20260908110300`).

### Tests

- `supabase/tests/visitors.sql` (`008fb45`). Branch rules per role, the auto
  date, cross-tenant reads, a member's token reading nothing, and conversion
  happening exactly once. Run through the Supabase MCP, like the rest.

---

## 2026-09-08 — Part of an entry can come back

### Added

- **Take back part of a payment that never arrived** (`47b1678`).
  `reverse_payment()` takes an amount, for the sale rung up at the full price
  when the member handed over less. One negative row for the difference, not a
  full undo plus a fresh payment; the invoice falls to part paid and the balance
  lands on the profile, in the members list and in arrears. Left empty it takes
  the whole entry, which is what it always did. What the invoice still holds is
  the ceiling on any correction, so part reversals cannot be repeated past the
  original entry. Owner and branch manager only, as before.

### Changed

- **The "never received" dialog asks what was actually paid** (`47b1678`), not
  what to take back, and subtracts it itself. Doing that arithmetic at the till
  is how the wrong number gets typed.

---

## 2026-09-07 — Corrections the front desk actually needs

The day's theme is the gap between what the desk records and what happened:
money that never arrived, a plan that starts on Tuesday, a member entered twice.

### Added

- **Archive a member instead of deleting them** (`cbd96a4`). `members.archived_at`
  hides a member from the list, the check-in search, the dashboard tiles and the
  absent-members call list, and changes no membership, invoice or derived status.
  Restore is one click from the new Archived filter. Everything financial still
  counts them — a due is a due whether or not the row is on screen.
- **Owner-only permanent delete** (`cbd96a4`). The RLS policy always refused
  everyone else; the profile now has the door, behind `requireRole('owner')` and
  a typed-name confirmation, because it takes the member's memberships, invoices
  and payments with it.
- **Paid in full / part paid / unpaid at the point of sale** (`d330e54`).
  Registration and renewal ask what actually came in. "Unpaid" unmounts the
  amount and payment-method fields entirely, so nothing false can be submitted;
  the invoice is still raised in full and the due lands on the profile and in
  arrears.
- **A sale can start on a future date** (`d330e54`). `register_member` takes
  `p_start_date` and the membership is created `upcoming` — the member who pays
  on Friday for a batch that begins Sunday.
- **Move the window of a membership already sold** (`f9b3d02`).
  `adjust_membership_dates` extends, corrects, or pushes back a membership.
  Owner or the branch's manager only, reason required, appended to the
  membership notes and recorded in `audit_log`. An expired membership returns to
  active when its new end date is ahead.
- **Reverse a payment that was never received** (`d280d14`). A third
  `payment_kind` beside `payment` and `refund`, for "I'll pay tomorrow" said
  after the sale was rung up. Mechanically a negative row the invoice totals
  follow back into a due, but reported separately so the collection sheet can
  tell money given back from money that never arrived. Owner and branch manager
  only.
- **Preset reasons on every reason box** (`a16bf1c`). Four one-tap chips above a
  textarea that stays visible and stays editable, on reversal, refund, cancel,
  freeze, mark-as-left, archive and date changes.

### Changed

- The old 15-argument `register_member` signature is dropped rather than left
  beside the new one: two overloads differing only by a trailing default make a
  named-argument call from PostgREST ambiguous (`d330e54`).
- `absent_members()` skips archived members. Financial reports deliberately do
  not (`cbd96a4`).
- Receipts print as "Payment correction" for a reversal, and the payments tab
  labels reversals "Never received" rather than lumping them in with refunds
  (`d280d14`).

### Database

- `members.archived_at` / `archived_reason` / `archived_by`, a partial index,
  `archive_member()` and `restore_member()` (`20260907120000`).
- `absent_members()` filters archived rows (`20260907120300`).
- `register_member(p_start_date)` (`20260907120100`).
- `adjust_membership_dates()`, superseding the same day's
  `adjust_membership_end_date()` (`20260907120200`, `20260907120400`).
- `payment_kind` gains `reversal`, `payments_kind_shape` widened, and
  `reverse_payment()` (`20260907120500`, `20260907120600`).

Moving a start date is the one exception to the append-only rule, and
`guard_membership_immutability` remains the enforcement point: it opens for
`start_date` only when `adjust_membership_dates` has set a flag on the
transaction, which a direct PostgREST update cannot do. It is refused once
anyone has checked in against the membership, and while the membership is
frozen. Plan, price, discount, branch and member stay immutable.

### Tests

- `supabase/tests/member_archive_and_dates.sql` and
  `supabase/tests/reverse_payment.sql` (`46b2eb3`). Both run through the
  Supabase MCP rather than psql, so neither is wired into CI yet.

---

## 2026-09-06 — Printed documents, and the gym's own details

### Added

- **A4 invoices and receipts on the org letterhead** (`9a363d8`). An invoice
  existed only as a database row; in a cash-heavy market where partial payment
  is normal, the paper slip *is* the receipt. Printed by the browser's own print
  engine rather than a PDF dependency, so real printers work. Verified at A4
  exactly, on one page.
- **An owner-only Settings screen** (`0b4a1c6`) for the gym's address, phone,
  PAN and logo — the letterhead the printed documents read. `currency` and
  `timezone` are deliberately not editable: changing either retroactively
  reinterprets every amount and timestamp already stored.
- **Print links where the desk is standing** (`287216b`) — after a sale, on the
  invoice row, beside a payment.
- **The joining fee as its own column** (`1e802f3`). `renew_membership` folded it
  into `price_paisa`, so the split existed in no row and a printed invoice could
  not name it as a line. Rows written before this carry 0, meaning "not
  separated" — never guessed back from the plan, which may have been repriced.
- **A public `org-logos` bucket** (`1e802f3`), unlike the private member-photos
  bucket, with owner-only writes. A signed URL adds three ways to print a
  logo-less invoice — an open tab past expiry, a cached render with a dead
  signature, a re-request after it lapsed — and a gym logo is on the shopfront
  already. SVG is excluded: storage serves objects from its own origin, and an
  SVG can carry script.
- **"New" instead of "Expired"** for a member who has never been sold anything
  (`63cc0c8`). The trigger-derived status does not move, because the Active
  tile, arrears and the churn list all depend on it; `member_overview` gains
  `has_membership_history` and only the badge reads it.

### Fixed

- **The inline plan dialog wiped the registration form** (`d2aa66f`).
  `createPlan` revalidated `/members`, which remounted the uncontrolled inputs
  and threw away whatever the desk had half-typed — the exact loss the inline
  dialog exists to prevent. The plan it created also failed to select itself: the
  pending id lived in the effect's dependency array, so clearing it queued a
  second transition that rebased on empty state and overwrote the selection.

---

## 2026-09-05 — The member spine, the front desk, and the mobile backend

### Added

- **Member spine** (`4ad26b5`): members, membership plans, append-only
  memberships, invoices, immutable payments. `members.status` is
  trigger-derived; invoice totals follow payment rows; renew, record payment,
  refund, freeze, unfreeze and cancel are SECURITY INVOKER RPCs so RLS stays the
  boundary. A nightly `pg_cron` sweep expires memberships in the org's own
  timezone.
- **The Phase 1 screens** (`a14a08a`): member list, registration, profile with
  full history, plan catalogue, sell/renew/refund/freeze from the profile, the
  daily collection sheet, arrears with age buckets, dashboard tiles.
- **Member photos** (`12dd74a`) in a private bucket keyed `<org_id>/<member_id>/`,
  read through short-lived signed URLs batched once per page. Plus
  `scripts/smoke.mjs`, which signs in through the API and asserts seeded data
  reaches all 18 Phase 1 routes — the gap `next build` cannot cover.
- **Attendance and check-in** (`77bd4e9`). The verdict lives in Postgres
  (`attendance_banner`, `in_gym_now`), not in the screen, so the Flutter front
  desk gets the same answer as the console. A duplicate same-day check-in is
  refused by a partial unique index and can only be overridden with a stated
  reason.
- **The member principal** (`f4db42d`): invite by email, adopt the row on first
  sign-in, `current_member()`. QR check-in moved out of the Edge Function into
  Postgres, signed with a key that provisions itself in Vault. Class schema with
  self-booking and waitlist promotion; device tokens and a push-fanout function
  (the FCM send path is written but unverified — the service account cannot be
  set from this tooling).
- **Register and sell in one submit** (landed inside `b72192d`, documented in
  `000723a`). One RPC, one transaction: a refused sale registers nobody, so the
  desk corrects one field and submits the same form again.
- **Staff invites** (`7a3ec58`) with branch assignment that mirrors the database
  rule, and a three-branch demo seed.
- **Tenant schema and staff auth** (`66c1591`): orgs, branches, staff,
  `audit_log`, RLS on all four, and an access-token hook that puts
  `{org_id, staff_id, staff_role, branch_ids}` in the JWT so policies read
  claims instead of sub-selecting the staff table on every row.

### Security

- **Members could read the whole gym** (`f4db42d`). Every "staff read X in their
  org" policy tested `is_org_member(org_id)` alone, which was airtight only
  while `org_id` could not appear in a non-staff token. Member tokens carry
  `org_id`, so each of those policies would have handed a member the roster,
  invoices and attendance. They now require `jwt_is_staff()`.
- **Four holes the member-principal audit found** (`b72192d`): the member-photos
  storage policy still tested `is_org_member()` alone, so any member could
  download another's photo; `link_member_account()` trusted an unconfirmed
  email, so signing up with someone else's address adopted their membership;
  push-fanout only branch-scoped the `branch_id` target, so naming `member_ids`
  pushed to the whole chain; `book_class_session` skipped `has_branch_access()`
  on the override path and read a membership row instead of the derived member
  status.
- **A manager could invite a peer manager** (`e96526b`). RLS held — no
  cross-tenant or owner-escalation path existed — but the insert policy was
  wider than the product. Now limited to front desk and trainer, with
  `assignableRoles()` shared by the form and the action.
- **Open redirect on login** (`cd9a8c1`). The `next` parameter was accepted
  whenever it began with a slash, so `//evil.example` resolved off-site.

### Fixed

- **Invited staff signed in to an empty gym** (`66f8d41`). Tenant claims are
  stamped when a token is issued, so adopting a staff row only takes effect
  after a refresh — and that refresh was happening in a Server Component, where
  cookie writes are swallowed. Linking moved to a route handler, and
  `requireStaff` heals sessions already in that state.
- Two colliding migration timestamps renamed, so replay order is defined
  (`000723a`).

### Documentation

- `PLANNING.md` as the architecture contract, `TASKS.md` as the phased backlog,
  `docs/PRD.md` for product context (`40078dd`). Shared-schema multi-tenancy
  isolated by RLS, cash-first billing, staff-only console, integer paisa,
  append-only financial history — with the alternatives that were rejected.
- The scope decision letting the front desk create plans, scoped to branches
  they work at (`000723a`).

---

## 2026-09-04 — Scaffolding

- The shadcn dashboard shell moved to the root route to serve as the index for
  `app.lordofgyms.com`; create-next-app and demo scaffolding stripped; login and
  signup pages added (`48592f9`).
- Initial commit from Create Next App (`8b9a49b`).
