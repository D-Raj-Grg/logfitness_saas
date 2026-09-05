// Retired. QR check-in tokens are minted and verified in Postgres now:
// public.mint_qr_token(p_member_id, p_ttl_seconds) and
// public.verify_qr_token(p_token) — see
// supabase/migrations/20260905150000_qr_tokens_in_postgres.sql.
//
// The Edge Function version needed a QR_TOKEN_SECRET project secret, which can
// only be set from the dashboard or a logged-in CLI. That made the whole path
// un-provisionable from the tooling this project uses, and it sat deployed
// answering 503. The signing key now lives in Vault and is created on first
// use, so a fresh database provisions itself.
//
// This stub stays deployed only because the Supabase MCP server has no
// delete-function tool. Delete the `qr-token` function from the dashboard and
// remove this directory whenever convenient — nothing calls it.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

Deno.serve(
  () =>
    new Response(
      JSON.stringify({
        error: 'Gone. Call the mint_qr_token / verify_qr_token RPCs instead.',
      }),
      { status: 410, headers: { 'Content-Type': 'application/json' } }
    )
)
