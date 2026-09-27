/**
 * Constrains a post-auth destination to a path on this site. A bare `//host`
 * or `/\host` both begin with a slash and are read by browsers as
 * protocol-relative URLs, which would turn a redirect into an open redirect.
 */
export function safeNext(value: unknown, fallback = '/'): string {
  const next = typeof value === 'string' ? value : ''

  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback
  }

  try {
    const placeholder = 'http://localhost'
    const resolved = new URL(next, placeholder)
    return resolved.origin === placeholder
      ? `${resolved.pathname}${resolved.search}`
      : fallback
  } catch {
    return fallback
  }
}
