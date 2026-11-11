/**
 * The link printed in a card's QR. A gym with its own site points cards at it
 * (orgs.settings.balance_url, e.g. "https://lordofgyms.com/balance"); otherwise
 * the console's own public page serves, keyed by the org slug.
 *
 * The link carries the card's random token (card_stock.qr_token, e.g.
 * "0004_k3x9q2mf"), never the bare card number: the number is printed on the
 * card for the desk and is easy to guess, so on its own it opens nothing. The
 * token is made by the database and is immutable, so a QR printed today keeps
 * working and "Download again" rebuilds the very same link.
 */

export const BALANCE_CARD_PARAM = 'c'

/** "https://lordofgyms.com/balance" + "0004_k3x9q2mf" -> "https://lordofgyms.com/balance?c=0004_k3x9q2mf". */
export function balanceLink(base: string, token: string): string {
  const trimmed = base.trim().replace(/[?&]$/, '')
  const sep = trimmed.includes('?') ? '&' : '?'
  return `${trimmed}${sep}${BALANCE_CARD_PARAM}=${encodeURIComponent(token)}`
}

/** The console's own public balance page for an org, used when no balance_url is set. */
export function defaultBalanceBase(siteOrigin: string, orgSlug: string): string {
  return `${siteOrigin.replace(/\/$/, '')}/balance?org=${encodeURIComponent(orgSlug)}`
}

/** Where this org's cards should point: its own site if set, else the console. */
export function resolveBalanceBase(opts: {
  balanceUrl: string | null | undefined
  siteOrigin: string
  orgSlug: string
}): string {
  const own = opts.balanceUrl?.trim()
  return own ? own : defaultBalanceBase(opts.siteOrigin, opts.orgSlug)
}
