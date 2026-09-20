/**
 * The RPCs raise with a sentence meant for the person at the desk. Getting it
 * in front of them is the whole point, so this is deliberately generous about
 * what it will read a message off.
 *
 * PostgREST hands the failure back as an object, not always as an `Error`:
 * depending on the client version it is a `PostgrestError` instance or a bare
 * `{ message, code, details, hint }`. Tested with `instanceof Error`, the bare
 * shape fell through to the fallback, and every RPC failure -- a discount
 * without a reason, a payment past the balance, a missing branch -- read
 * "could not be recorded" at the desk, with the actual sentence nowhere.
 *
 * The SQLSTATE prefix ("P0001: ...") that PostgREST sometimes glues on is
 * noise here and comes off.
 */
export function rpcErrorMessage(error: unknown, fallback: string) {
  const message =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message ?? '')
        : null

  const trimmed = message?.replace(/^[A-Z0-9]{5}:\s*/, '').trim()
  return trimmed ? trimmed : fallback
}
