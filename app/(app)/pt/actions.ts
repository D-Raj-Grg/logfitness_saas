'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { requireStaff } from '@/lib/auth'
import {
  bookPtSession,
  cancelPtSession,
  completePtSession,
  findMemberByCode,
} from '@/lib/db/pt'
import { rpcErrorMessage } from '@/lib/rpc-error'

function back(error?: string): never {
  redirect(error ? `/pt?error=${encodeURIComponent(error)}` : '/pt')
}

const bookSchema = z.object({
  memberCode: z.string().trim().min(1, 'Enter the member code'),
  trainerId: z.uuid('Choose a trainer'),
  // datetime-local, entered at the desk in Kathmandu time.
  scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Choose a date and time'),
  durationMinutes: z.coerce.number().int().min(5).max(480),
  notes: z.string().trim().max(500).optional(),
})

export async function bookPtAction(formData: FormData) {
  await requireStaff()

  const parsed = bookSchema.safeParse({
    memberCode: formData.get('memberCode'),
    trainerId: formData.get('trainerId'),
    scheduledAt: formData.get('scheduledAt'),
    durationMinutes: formData.get('durationMinutes') || 60,
    notes: formData.get('notes') || undefined,
  })
  if (!parsed.success) back(parsed.error.issues[0]?.message ?? 'Check the form')

  let failure: string | null = null
  try {
    const member = await findMemberByCode(parsed.data.memberCode)
    if (!member) {
      failure = 'No member has that code.'
    } else {
      await bookPtSession({
        memberId: member.id,
        trainerId: parsed.data.trainerId,
        scheduledAt: new Date(`${parsed.data.scheduledAt}:00+05:45`).toISOString(),
        durationMinutes: parsed.data.durationMinutes,
        notes: parsed.data.notes,
      })
    }
  } catch (error) {
    failure = rpcErrorMessage(error, 'The session could not be scheduled.')
  }

  if (failure) back(failure)
  revalidatePath('/pt')
  back()
}

const idSchema = z.object({ id: z.uuid() })

export async function completePtAction(formData: FormData) {
  await requireStaff()
  const parsed = idSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) back('Invalid request')

  let failure: string | null = null
  try {
    await completePtSession(parsed.data.id)
  } catch (error) {
    failure = rpcErrorMessage(error, 'The session could not be completed.')
  }
  if (failure) back(failure)
  revalidatePath('/pt')
  back()
}

export async function cancelPtAction(formData: FormData) {
  await requireStaff()
  const parsed = idSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) back('Invalid request')

  let failure: string | null = null
  try {
    await cancelPtSession(parsed.data.id)
  } catch (error) {
    failure = rpcErrorMessage(error, 'The session could not be cancelled.')
  }
  if (failure) back(failure)
  revalidatePath('/pt')
  back()
}
