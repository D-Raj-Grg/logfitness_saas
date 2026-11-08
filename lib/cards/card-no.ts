/**
 * Printed card numbers. A gym prints "NO. 0004" on each RFID card; the number
 * is how the desk finds and hands out a card without scanning it. These helpers
 * mirror public.parse_card_no / public.format_card_no in the database so the
 * form, the list, the designer and the public balance page agree on what "4",
 * "04", "0004" and "NO. 0004" mean.
 */

export const CARD_NO_MIN = 1
export const CARD_NO_MAX = 9999

/** "NO. 0004", "0004", "04", "4" -> 4. Null when there is no usable number. */
export function parseCardNo(text: string | null | undefined): number | null {
  const digits = (text ?? '').replace(/[^0-9]/g, '')
  if (digits === '' || digits.length > 4) return null
  const n = Number.parseInt(digits, 10)
  if (!Number.isInteger(n) || n < CARD_NO_MIN || n > CARD_NO_MAX) return null
  return n
}

/** 4 -> "0004". */
export function formatCardNo(n: number): string {
  return String(n).padStart(4, '0')
}

/** What is printed on the card: "NO. 0004". An empty prefix gives "0004". */
export function cardLabel(n: number, prefix = 'NO.'): string {
  const p = prefix.trim()
  return p ? `${p} ${formatCardNo(n)}` : formatCardNo(n)
}
