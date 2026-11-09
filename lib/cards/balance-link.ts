import { formatCardNo } from '@/lib/cards/card-no'

/**
 * The link printed in a card's QR. A gym with its own site points cards at it
 * (orgs.settings.balance_url, e.g. "https://lordofgyms.com/balance"); otherwise
 * the console's own public page serves, keyed by the org slug.
 *
 * The URL is on plastic for years, so it carries only the printed number --
 * never an id, never a token the gym could later want to rotate.
 */

export const BALANCE_CARD_PARAM = 'card_no'

/** "https://lordofgyms.com/balance" + 4 -> "https://lordofgyms.com/balance?card_no=0004". */
export function balanceLink(base: string, cardNo: number): string {
  const trimmed = base.trim().replace(/[?&]$/, '')
  const sep = trimmed.includes('?') ? '&' : '?'
  return `${trimmed}${sep}${BALANCE_CARD_PARAM}=${formatCardNo(cardNo)}`
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
