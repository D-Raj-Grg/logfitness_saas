'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import { addOrgHoliday, removeOrgHoliday, setWeeklyOff } from '@/lib/db/org-schedule'

export type ScheduleFormState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[] | undefined>
}

const weeklyOffSchema = z.object({
  days: z.array(z.coerce.number().int().min(1).max(7)).max(7),
})

const holidaySchema = z.object({
  onDate: z.iso.date('Pick a date'),
  name: z.string().trim().min(1, 'Give the holiday a name').max(80, 'Keep it to 80 characters'),
})

const holidayIdSchema = z.object({ id: z.uuid() })

function message(error: unknown) {
  const { code, message } = (error ?? {}) as { code?: string; message?: string }
  if (code === '42501') return 'Only an owner or manager can change the gym schedule.'
  if (code === '23505') return 'A holiday is already set for that date.'
  return message ?? 'Something went wrong. Please try again.'
}

// The database refuses anyone but owner/manager; the gate here is the friendly
// early exit and keeps the page and the actions on one rule.
export async function saveWeeklyOff(
  _prev: ScheduleFormState,
  formData: FormData
): Promise<ScheduleFormState> {
  await requireRole('owner', 'manager')

  const parsed = weeklyOffSchema.safeParse({ days: formData.getAll('weeklyOff') })
  if (!parsed.success) return { error: 'Choose weekdays between Monday and Sunday.' }

  try {
    await setWeeklyOff([...new Set(parsed.data.days)].sort((a, b) => a - b))
  } catch (error) {
    return { error: message(error) }
  }

  revalidatePath('/settings/schedule')
  return { success: 'Weekly days off saved.' }
}

export async function addHoliday(
  _prev: ScheduleFormState,
  formData: FormData
): Promise<ScheduleFormState> {
  await requireRole('owner', 'manager')

  const parsed = holidaySchema.safeParse({
    onDate: formData.get('onDate'),
    name: formData.get('name'),
  })
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors }

  try {
    await addOrgHoliday(parsed.data.onDate, parsed.data.name)
  } catch (error) {
    return { error: message(error) }
  }

  revalidatePath('/settings/schedule')
  return { success: 'Holiday added.' }
}

export async function removeHoliday(
  _prev: ScheduleFormState,
  formData: FormData
): Promise<ScheduleFormState> {
  await requireRole('owner', 'manager')

  const parsed = holidayIdSchema.safeParse({ id: formData.get('id') })
  if (!parsed.success) return { error: 'That holiday could not be found.' }

  try {
    await removeOrgHoliday(parsed.data.id)
  } catch (error) {
    return { error: message(error) }
  }

  revalidatePath('/settings/schedule')
  return { success: 'Holiday removed.' }
}
