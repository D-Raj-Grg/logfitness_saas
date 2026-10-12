'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import { markSessionAttendance } from '@/lib/db/trainer-sessions'
import { rpcErrorMessage } from '@/lib/rpc-error'

const schema = z.object({
  bookingId: z.uuid(),
  attended: z.enum(['yes', 'no']),
})

export async function markAttendanceAction(formData: FormData) {
  await requireRole('trainer', 'manager', 'owner')

  const parsed = schema.safeParse({
    bookingId: formData.get('bookingId'),
    attended: formData.get('attended'),
  })
  if (!parsed.success) redirect('/trainer-sessions?error=Invalid+request')

  let failure: string | null = null
  try {
    await markSessionAttendance(parsed.data.bookingId, parsed.data.attended === 'yes')
  } catch (error) {
    failure = rpcErrorMessage(error, 'Attendance could not be saved.')
  }

  if (failure) redirect(`/trainer-sessions?error=${encodeURIComponent(failure)}`)
  revalidatePath('/trainer-sessions')
}
