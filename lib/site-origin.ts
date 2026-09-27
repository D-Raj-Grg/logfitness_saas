/**
 * The origin used in links this server sends by email. Never read from the
 * request: a forged Host or Origin header would otherwise put an attacker's
 * domain in front of a reset token.
 */
export function siteOrigin() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3000')
  )
}
