'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import { cardLabel, formatCardNo, parseCardNo } from '@/lib/cards/card-no'
import {
  assignCardStockToMember,
  createCardStockRange as createCardStockRangeRpc,
  getCardStockByNo,
  linkCardStockUid as linkCardStockUidRpc,
  setCardStockStatus as setCardStockStatusRpc,
} from '@/lib/db/card-stock'
import { searchMembersForCheckIn } from '@/lib/db/members'
import { rpcErrorMessage } from '@/lib/rpc-error'
import {
  assignByCardNoSchema,
  createRangeSchema,
  linkUidSchema,
  stockStatusSchema,
} from '@/lib/validation/cards'

export type CardFormState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[] | undefined>
}

const DESK_ROLES = ['owner', 'manager', 'front_desk'] as const
const NUMBERING_ROLES = ['owner', 'manager'] as const

/** Every screen that shows a card's number or holder. */
function revalidateCardViews(memberId?: string) {
  revalidatePath('/cards')
  revalidatePath('/members')
  if (memberId) revalidatePath(`/members/${memberId}`)
  else revalidatePath('/members/[id]', 'page')
}

/**
 * Number a fresh run of printed cards. A purchasing decision, so owner and
 * manager only; the RPC repeats the check and refuses a number that exists.
 */
export async function createCardStockRange(
  _prevState: CardFormState,
  formData: FormData
): Promise<CardFormState> {
  await requireRole(...NUMBERING_ROLES)

  const parsed = createRangeSchema.safeParse({
    from: formData.get('from'),
    to: formData.get('to'),
  })
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  let created
  try {
    created = await createCardStockRangeRpc(parsed.data)
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The cards could not be numbered.') }
  }

  revalidatePath('/cards')
  revalidatePath('/cards/designer')
  return {
    success: `Numbered ${created.created} cards, ${cardLabel(created.from_no)} to ${cardLabel(
      created.to_no
    )}.`,
  }
}

/** Marry a printed number to the chip inside it, from a tap or a typed UID. */
export async function linkCardStockUid(
  _prevState: CardFormState,
  formData: FormData
): Promise<CardFormState> {
  await requireRole(...DESK_ROLES)

  const parsed = linkUidSchema.safeParse({
    cardNo: formData.get('cardNo') ?? '',
    cardUid: formData.get('cardUid') ?? '',
  })
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  try {
    await linkCardStockUidRpc(parsed.data)
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The chip could not be linked.') }
  }

  revalidateCardViews()
  return { success: `Chip linked to ${cardLabel(parsed.data.cardNo)}.` }
}

/** Lost, retired, or found again. The RPC refuses while someone holds it. */
export async function setCardStockStatus(
  _prevState: CardFormState,
  formData: FormData
): Promise<CardFormState> {
  await requireRole(...DESK_ROLES)

  const parsed = stockStatusSchema.safeParse({
    cardNo: formData.get('cardNo') ?? '',
    status: formData.get('status'),
    reason: formData.get('reason') ?? '',
  })
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  try {
    await setCardStockStatusRpc(parsed.data)
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The card status could not be changed.') }
  }

  revalidatePath('/cards')
  const label = cardLabel(parsed.data.cardNo)
  return {
    success:
      parsed.data.status === 'free'
        ? `${label} is back in the free pile.`
        : `${label} marked ${parsed.data.status}.`,
  }
}

/**
 * Hand a numbered card to a member from the card list. The same RPC path as
 * the member profile's dialog; this one starts from the card instead.
 */
export async function assignCardToMember(
  _prevState: CardFormState,
  formData: FormData
): Promise<CardFormState> {
  await requireRole(...DESK_ROLES)

  const parsed = assignByCardNoSchema.safeParse({
    memberId: formData.get('memberId'),
    cardNo: formData.get('cardNo') ?? '',
    cardUid: formData.get('cardUid') ?? '',
    replace: formData.get('replace') ?? undefined,
  })
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors
    // The member comes from a picker, so a missing one is a plain sentence.
    if (fieldErrors.memberId) return { error: 'Pick the member who is taking this card.' }
    return { fieldErrors }
  }
  if (parsed.data.cardNo === undefined) {
    return { error: 'That card has no printed number.' }
  }

  try {
    await assignCardStockToMember({
      memberId: parsed.data.memberId,
      cardNo: parsed.data.cardNo,
      cardUid: parsed.data.cardUid,
      replace: parsed.data.replace,
    })
  } catch (error) {
    return { error: rpcErrorMessage(error, 'The card could not be assigned.') }
  }

  revalidateCardViews(parsed.data.memberId)
  return { success: `${cardLabel(parsed.data.cardNo)} assigned.` }
}

export type CardMemberHit = {
  id: string
  member_code: string
  full_name: string
  phone: string
  status: string
  card_no: number | null
}

/**
 * Type-ahead for the assign dialog's member picker. A read exposed as an
 * action so it runs under the caller's RLS, like the check-in box's search.
 */
export async function searchMembersForCard(term: string): Promise<{ members: CardMemberHit[] }> {
  await requireRole(...DESK_ROLES)

  const parsed = z.string().trim().max(120).safeParse(term)
  if (!parsed.success || parsed.data.length < 2) return { members: [] }

  const rows = await searchMembersForCheckIn(parsed.data)
  return {
    members: rows.map((row) => ({
      id: row.id,
      member_code: row.member_code,
      full_name: row.full_name,
      phone: row.phone,
      status: row.status,
      card_no: row.card_no ?? null,
    })),
  }
}

export type CardStockLookup =
  | { found: false; label: string }
  | {
      found: true
      cardNo: number
      label: string
      effectiveStatus: 'assigned' | 'free' | 'lost' | 'retired'
      hasChip: boolean
      holderKind: 'member' | 'staff' | null
      holderName: string | null
      memberCode: string | null
      memberId: string | null
      /** One line for the dialog: "free · chip linked", "held by Ramesh (M00012)". */
      summary: string
    }

/**
 * What the dialog says about a typed number before the desk submits. Any
 * desk role may ask; the view is already limited to the caller's org.
 */
export async function lookupCardStock(text: string): Promise<CardStockLookup | null> {
  await requireRole(...DESK_ROLES)

  const cardNo = parseCardNo(z.string().max(20).catch('').parse(text))
  if (cardNo === null) return null

  const row = await getCardStockByNo(cardNo).catch(() => null)
  if (!row) return { found: false, label: `No card numbered ${formatCardNo(cardNo)}` }

  const hasChip = Boolean(row.card_uid)
  let summary: string
  switch (row.effective_status) {
    case 'assigned':
      summary =
        row.holder_kind === 'staff'
          ? 'held by a staff member'
          : `held by ${row.holder_name ?? 'a member'}${row.member_code ? ` (${row.member_code})` : ''}`
      break
    case 'free':
      summary = hasChip ? 'free · chip linked' : 'free · no chip yet'
      break
    default:
      summary = `marked ${row.effective_status}`
  }

  return {
    found: true,
    cardNo,
    label: cardLabel(cardNo),
    effectiveStatus: row.effective_status,
    hasChip,
    holderKind: row.holder_kind,
    holderName: row.holder_name,
    memberCode: row.member_code,
    memberId: row.member_id,
    summary,
  }
}
