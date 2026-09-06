/**
 * Logo constants and the public URL. Kept out of lib/db/orgs.ts so a client
 * component -- the letterhead renders in the Settings preview too -- can import
 * them without dragging the server-only Supabase client into the browser
 * bundle.
 */

export const ORG_LOGO_BUCKET = 'org-logos'

/** Matches the bucket's own limit, so a bad file is refused before upload. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024
export const ALLOWED_LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * Objects are keyed <org_id>/logo-<epoch>.<ext>. The storage policies read the
 * first segment, so the path is the tenant boundary here as it is for member
 * photos. The timestamp means a replacement never collides with the file it
 * replaces, which is what lets the old one be deleted only after the new path
 * is safely on the org row.
 */
export function orgLogoPath(orgId: string, type: string) {
  const extension = EXTENSIONS[type] ?? 'png'
  return `${orgId}/logo-${Date.now()}.${extension}`
}

/**
 * Synchronous, unlike memberPhotoUrl -- deliberately. This bucket is public, so
 * the URL is derived from the path rather than signed, and nothing can expire
 * while a print tab sits open waiting for someone to hit Ctrl+P.
 *
 * Built by hand rather than through storage.getPublicUrl() because getting a
 * client is async, and a public object URL is a pure function of the path.
 */
export function orgLogoUrl(path: string | null) {
  if (!path) return null

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null

  return `${base}/storage/v1/object/public/${ORG_LOGO_BUCKET}/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
}
