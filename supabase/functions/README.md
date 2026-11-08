# Edge Functions

Five functions are deployed. Each one's header comment is the authoritative
statement of its auth model; this table is the index.

| Function | Purpose | `verify_jwt` | How the caller authenticates | RPCs called (who may execute them) | Env / secrets |
|---|---|---|---|---|---|
| `rfid-check` | Door reader posts a card UID (`{ uid, ts?, fw? }`) and gets allow/deny for the OLED and buzzer. | `false` | `x-device-key` header (the device key minted by `register_device` / `rotate_device_key`). The key is sha256-hashed here; only the hash reaches Postgres, which derives org and branch from the device row. | `rfid_check_in(p_key_hash, p_card_uid, p_scanned_at)` — `service_role` only | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (injected by the platform) |
| `rfid-sync` | Offline mode for the reader: `GET` pages the card list as `UID,YYYYMMDD,C,Name` lines; `POST { events }` backfills taps let in while offline (max 100). | `false` | Same as `rfid-check`: `x-device-key`, hashed before it reaches Postgres. | `rfid_sync_cards(p_key_hash, p_after, p_limit)`, `rfid_log_offline(p_key_hash, p_events)` — `service_role` only | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `push-fanout` | Sends an FCM HTTP v1 push to one member, a list, or every live member of a branch. | `true` | Two layers: the gateway checks the Supabase JWT, then the function builds a client with the caller's own JWT and calls `current_staff()` through RLS to prove the caller is active staff of the org named in the body (and can reach the branch). Only then does it switch to the service role to read device tokens and write `push_log` / `device_tokens`. | `current_staff()` — `authenticated`, RLS-scoped, via the caller's JWT. Token reads and log writes via service role. | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FCM_SERVICE_ACCOUNT_JSON` (project secret; unset → 503, send path unverified) |
| `qr-token` | **Retired.** Answers `410 Gone`. QR tokens are minted and verified in Postgres (`mint_qr_token` / `verify_qr_token`). Still deployed only because the MCP server has no delete-function tool. | n/a (stub) | None — every request gets 410. | None | None |
| `public-balance` | The public balance API behind the QR on a printed member card: `GET ?org=&card_no=` → masked name, plan, status, days left; `POST /renew-request` files a "please renew me" request. | `false` | No caller secret: the page is opened by a member in a browser off a printed QR. The service role is used solely to call two RPCs that are executable by `service_role` only; the org is resolved by slug in Postgres and nothing in the request is trusted for identity. Input is shape-validated before the RPC. Best-effort per-instance IP rate limit (30/min); the DB `too_soon` rule is the real backstop for renew requests. | `public_card_balance(p_org_slug, p_card_no)`, `public_renewal_request(p_org_slug, p_card_no, p_phone, p_note)` — `service_role` only | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; optional `BALANCE_ALLOWED_ORIGINS` (comma-separated origins for CORS; unset = `*`) |

## Deploying

There is no `supabase/config.toml` in this repo, so `verify_jwt` is set at
deploy time — through the MCP tool `deploy_edge_function` (`verify_jwt: false`
for `rfid-check`, `rfid-sync` and `public-balance`; `true` for `push-fanout`)
or `supabase functions deploy <name> --no-verify-jwt`. Include each function's
`deno.json` alongside `index.ts`.

Project secrets (`FCM_SERVICE_ACCOUNT_JSON`, `BALANCE_ALLOWED_ORIGINS`) can
only be set from the Supabase dashboard or a logged-in CLI. Both are optional
for the functions to boot: `push-fanout` answers 503 without its secret, and
`public-balance` allows every origin without its list.
