/**
 * A card's link token: the random key printed in its QR, "0004_k3x9q2mf" --
 * the 4-digit card number, an underscore and 8 random characters. It is the
 * only thing the public balance page accepts: a printed number alone opens
 * nothing, so nobody can walk 0001..9999 to read other members' balances.
 *
 * Mirrors the check on card_stock.qr_token and the Edge Function's
 * CARD_TOKEN_RE. The database makes the tokens (new_card_token); the browser
 * only ever receives them to put in the QR.
 */

import { formatCardNo } from '@/lib/cards/card-no'

export const CARD_TOKEN_RE = /^[0-9]{4}_[a-z2-9]{8}$/

/** One card to print: its printed number and the random token its QR carries. */
export type PrintCard = { cardNo: number; token: string }

/** The token as typed or scanned, or null when it cannot be one. Case matters. */
export function parseCardToken(text: string | null | undefined): string | null {
  const token = (text ?? '').trim()
  return CARD_TOKEN_RE.test(token) ? token : null
}

/**
 * A token-shaped placeholder for previews (the designer's sample QR). Same
 * length as a real one, so the preview QR has the density the printed one will.
 */
export function sampleCardToken(cardNo = 1): string {
  return `${formatCardNo(cardNo)}_k3x9q2mf`
}
