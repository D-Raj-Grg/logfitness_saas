import { createClient } from '@/lib/supabase/server'

export const MEMBER_PHOTO_BUCKET = 'member-photos'

/** Matches the bucket's own limits, so a bad file is refused before upload. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * Objects are keyed <org_id>/<member_id>/<name>. The storage policies read the
 * first segment, so the path is the tenant boundary here just as org_id is on
 * every table.
 */
export function memberPhotoPath(orgId: string, memberId: string, type: string) {
  const extension = EXTENSIONS[type] ?? 'jpg'
  return `${orgId}/${memberId}/${Date.now()}.${extension}`
}

export async function uploadMemberPhoto(path: string, file: File) {
  const supabase = await createClient()

  const { error } = await supabase.storage
    .from(MEMBER_PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (error) throw error
  return path
}

export async function removeMemberPhoto(path: string) {
  const supabase = await createClient()
  const { error } = await supabase.storage.from(MEMBER_PHOTO_BUCKET).remove([path])
  if (error) throw error
}

/**
 * The bucket is private, so every render needs a fresh signed URL. Returns null
 * rather than throwing: a missing photo must never take down a member profile.
 */
export async function memberPhotoUrl(path: string | null, expiresIn = 60 * 60) {
  if (!path) return null

  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from(MEMBER_PHOTO_BUCKET)
    .createSignedUrl(path, expiresIn)

  if (error) return null
  return data.signedUrl
}

/** One round trip for a whole page of members. */
export async function memberPhotoUrls(paths: (string | null)[], expiresIn = 60 * 60) {
  const wanted = [...new Set(paths.filter((path): path is string => Boolean(path)))]
  if (wanted.length === 0) return {} as Record<string, string>

  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from(MEMBER_PHOTO_BUCKET)
    .createSignedUrls(wanted, expiresIn)

  if (error || !data) return {}

  return Object.fromEntries(
    data
      .filter((entry) => entry.signedUrl && entry.path)
      .map((entry) => [entry.path as string, entry.signedUrl])
  ) as Record<string, string>
}
