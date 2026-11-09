import { createClient } from '@/lib/supabase/client'

export const CARD_TEMPLATE_BUCKET = 'card-templates'
export const MAX_TEMPLATE_BYTES = 5 * 1024 * 1024
export const ALLOWED_TEMPLATE_TYPES = ['image/jpeg', 'image/png']

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

/**
 * Uploads a card template straight from the browser into the private bucket,
 * keyed <org_id>/<random>.<ext>. The storage policy reads the first folder and
 * refuses anyone who is not an owner or manager of that org, so the key is the
 * tenant boundary here just as org_id is on every table. A fresh name per
 * upload means a stale signed URL can never show an older picture.
 *
 * Browser-side rather than through a Server Action because a Server Action
 * body is capped at 1 MB and the bucket allows 5 MB.
 *
 * Returns the object path to hand to save_card_design().
 */
export async function uploadCardTemplate(file: File, orgId: string): Promise<string> {
  const ext = EXTENSIONS[file.type]
  if (!ext) throw new Error('Use a JPEG or PNG picture.')
  if (file.size > MAX_TEMPLATE_BYTES) throw new Error('The picture must be under 5 MB.')

  const path = `${orgId}/${crypto.randomUUID()}.${ext}`
  const supabase = createClient()
  const { error } = await supabase.storage
    .from(CARD_TEMPLATE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(`The picture didn't upload: ${error.message}`)
  return path
}

/** Best effort: drop an upload the save then refused. */
export async function removeUploadedTemplate(path: string) {
  const supabase = createClient()
  await supabase.storage.from(CARD_TEMPLATE_BUCKET).remove([path])
}
