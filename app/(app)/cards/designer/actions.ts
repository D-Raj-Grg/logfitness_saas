'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import {
  createCardStockRange,
  deleteCardDesign as deleteCardDesignDb,
  getBatchQrTokens,
  listCardDesigns,
  removeCardTemplate,
  saveCardDesign as saveCardDesignDb,
} from '@/lib/db/card-designs'
import type { PrintCard } from '@/lib/cards/card-token'
import { rpcErrorMessage } from '@/lib/rpc-error'
import type { Json } from '@/lib/types/database'
import {
  batchPrintSchema,
  cardRangeSchema,
  deleteCardDesignSchema,
  saveCardDesignSchema,
} from '@/lib/validation/card-designs'

const DESIGNER_ROLES = ['owner', 'manager'] as const

export type DesignActionResult = { error: string } | { ok: true; id: string }

/**
 * Save a design: the picture already uploaded by the browser, where the
 * number and QR sit on it, and the label prefix. On an update the previous
 * picture is removed only once the row points at the new one, so a failure
 * part-way leaves the old design working; on a refused save the fresh upload
 * is removed so the bucket does not collect orphans.
 */
export async function saveCardDesign(input: unknown): Promise<DesignActionResult> {
  await requireRole(...DESIGNER_ROLES)

  const parsed = saveCardDesignSchema.safeParse(input)
  if (!parsed.success) {
    const first = Object.values(z.flattenError(parsed.error).fieldErrors).flat()[0]
    return { error: first ?? 'Check the design and try again.' }
  }
  const data = parsed.data

  let previous: string | null = null
  if (data.id) {
    const designs = await listCardDesigns()
    previous = designs.find((d) => d.id === data.id)?.image_path ?? null
  }

  let id: string
  try {
    id = await saveCardDesignDb({
      id: data.id,
      name: data.name,
      imagePath: data.imagePath,
      width: data.width,
      height: data.height,
      placement: data.placement as unknown as Json,
      labelPrefix: data.labelPrefix,
    })
  } catch (error) {
    if (data.imagePath !== previous) await removeCardTemplate(data.imagePath)
    // unique (org_id, name) raises the raw constraint text; say it plainly.
    const code =
      typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null
    if (code === '23505') return { error: `A design named ${data.name} already exists.` }
    return { error: rpcErrorMessage(error, 'The design could not be saved.') }
  }

  if (previous && previous !== data.imagePath) await removeCardTemplate(previous)

  revalidatePath('/cards')
  revalidatePath('/cards/designer')
  return { ok: true, id }
}

/** Delete a design and its picture. Runs that used it stay, pointing at no design. */
export async function deleteCardDesign(input: unknown): Promise<DesignActionResult> {
  await requireRole(...DESIGNER_ROLES)

  const parsed = deleteCardDesignSchema.safeParse(input)
  if (!parsed.success) return { error: 'That design does not exist.' }

  try {
    await deleteCardDesignDb(parsed.data.id)
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The design could not be deleted.') }
  }

  revalidatePath('/cards')
  revalidatePath('/cards/designer')
  return { ok: true, id: parsed.data.id }
}

export type CreatedRange = { batchId: string; cards: PrintCard[] }
export type RangeActionResult = { error: string } | ({ ok: true } & CreatedRange)

/**
 * Number a run of cards for printing. The stock rows are written first, so a
 * PDF is only ever built for numbers the database already knows about; the
 * database makes each card's random link token and hands it back here, and
 * the browser then renders and downloads the PDF with it in the QR.
 */
export async function createCardStockRangeForPrint(input: unknown): Promise<RangeActionResult> {
  await requireRole(...DESIGNER_ROLES)

  const parsed = cardRangeSchema.safeParse(input)
  if (!parsed.success) {
    const first = Object.values(z.flattenError(parsed.error).fieldErrors).flat()[0]
    return { error: first ?? 'Check the range and try again.' }
  }

  let created
  try {
    created = await createCardStockRange(parsed.data)
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The cards could not be numbered.') }
  }

  const cards: PrintCard[] = (created.cards ?? []).map((c) => ({
    cardNo: c.card_no,
    token: c.token,
  }))

  revalidatePath('/cards')
  revalidatePath('/cards/designer')
  return { ok: true, batchId: created.batch_id, cards }
}

export type BatchCardsResult = { error: string } | { ok: true; cards: PrintCard[] }

/**
 * "Download again": the cards of a past run with their tokens. Tokens are
 * immutable, so the PDF this rebuilds carries the same QR codes as the first.
 */
export async function getBatchPrintCards(input: unknown): Promise<BatchCardsResult> {
  await requireRole(...DESIGNER_ROLES)

  const parsed = batchPrintSchema.safeParse(input)
  if (!parsed.success) return { error: 'That print run does not exist.' }

  try {
    const cards = await getBatchQrTokens(parsed.data.batchId)
    if (cards.length === 0) return { error: 'That print run has no cards.' }
    return { ok: true, cards }
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The cards could not be loaded.') }
  }
}
