import { createClient } from '@/lib/supabase/server'
import type { Database, Json } from '@/lib/types/database'

export const CARD_TEMPLATE_BUCKET = 'card-templates'

/** Matches the bucket's own limits, so a bad file is refused before upload. */
export const MAX_TEMPLATE_BYTES = 5 * 1024 * 1024
export const ALLOWED_TEMPLATE_TYPES = ['image/jpeg', 'image/png']

export type CardDesignRow = Database['public']['Tables']['card_designs']['Row']
export type CardBatchRow = Database['public']['Tables']['card_batches']['Row']

function unwrap<T>(result: { data: unknown; error: { message: string } | null }) {
  if (result.error) throw result.error
  return result.data as T
}

/** Every design in the caller's org, newest change first. RLS scopes it. */
export async function listCardDesigns(): Promise<CardDesignRow[]> {
  const supabase = await createClient()
  return (
    unwrap<CardDesignRow[]>(
      await supabase.from('card_designs').select('*').order('updated_at', { ascending: false })
    ) ?? []
  )
}

/**
 * The bucket is private, so every render needs fresh signed URLs. One round
 * trip for the whole gallery; a path that fails to sign is simply absent.
 */
export async function signedTemplateUrls(paths: string[], expiresIn = 60 * 60) {
  const wanted = [...new Set(paths.filter(Boolean))]
  if (wanted.length === 0) return {} as Record<string, string>

  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from(CARD_TEMPLATE_BUCKET)
    .createSignedUrls(wanted, expiresIn)

  if (error || !data) return {}

  return Object.fromEntries(
    data
      .filter((entry) => entry.signedUrl && entry.path)
      .map((entry) => [entry.path as string, entry.signedUrl])
  ) as Record<string, string>
}

export async function saveCardDesign(args: {
  id: string | null
  name: string
  imagePath: string
  width: number
  height: number
  placement: Json
  labelPrefix: string
}): Promise<string> {
  const supabase = await createClient()
  return unwrap<string>(
    await supabase.rpc('save_card_design', {
      // No default on p_id in SQL, so it must travel as an explicit JSON null:
      // an omitted key would make PostgREST look for a six-argument function.
      p_id: args.id as unknown as string,
      p_name: args.name,
      p_image_path: args.imagePath,
      p_width: args.width,
      p_height: args.height,
      p_placement: args.placement,
      p_label_prefix: args.labelPrefix,
    })
  )
}

/** Deletes the row, then the picture it pointed at. Returns the removed path. */
export async function deleteCardDesign(id: string): Promise<string> {
  const supabase = await createClient()
  const path = unwrap<string>(await supabase.rpc('delete_card_design', { p_id: id }))
  if (path) await supabase.storage.from(CARD_TEMPLATE_BUCKET).remove([path])
  return path
}

/** Best effort: a picture nothing points at any more. Failure is not an error. */
export async function removeCardTemplate(path: string) {
  const supabase = await createClient()
  await supabase.storage.from(CARD_TEMPLATE_BUCKET).remove([path])
}

/** Past print runs, newest first. RLS scopes it. */
export async function listCardBatches(): Promise<CardBatchRow[]> {
  const supabase = await createClient()
  return (
    unwrap<CardBatchRow[]>(
      await supabase.from('card_batches').select('*').order('created_at', { ascending: false })
    ) ?? []
  )
}

export type CreatedCardRange = {
  batch_id: string
  from_no: number
  to_no: number
  created: number
}

/** Numbers a run of cards against a design (or none). Owner or manager; the RPC checks. */
export async function createCardStockRange(args: {
  from: number
  to: number
  designId: string | null
}): Promise<CreatedCardRange> {
  const supabase = await createClient()
  return unwrap<CreatedCardRange>(
    await supabase.rpc('create_card_stock_range', {
      p_from: args.from,
      p_to: args.to,
      p_design_id: args.designId ?? undefined,
    })
  )
}

/** The number the next run would start at. */
export async function nextFreeCardNo(): Promise<number> {
  const supabase = await createClient()
  return unwrap<number>(await supabase.rpc('next_free_card_no')) ?? 1
}
