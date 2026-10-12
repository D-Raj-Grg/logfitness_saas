'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireRole } from '@/lib/auth'
import { listSessionBookings, type SessionBooking } from '@/lib/db/class-sessions'
import { searchMembersForCheckIn } from '@/lib/db/members'
import { rpcErrorMessage } from '@/lib/rpc-error'
import { createClient } from '@/lib/supabase/server'
import {
  bookSchema,
  cancelBookingSchema,
  classSchema,
  rescheduleSchema,
  updateClassSchema,
} from '@/lib/validation/classes'

export type ClassFormState = {
  error?: string
  success?: string
  fieldErrors?: Record<string, string[]>
}

const DESK = ['owner', 'manager', 'front_desk'] as const

function classValues(formData: FormData) {
  return {
    name: formData.get('name'),
    description: formData.get('description') ?? undefined,
    branchId: formData.get('branchId'),
    trainerId: formData.get('trainerId') ?? undefined,
    capacity: formData.get('capacity'),
    room: formData.get('room') ?? undefined,
    recurrence: formData.get('recurrence') ?? '[]',
    isActive: formData.get('isActive') !== 'false',
  }
}

function revalidateClasses() {
  revalidatePath('/classes')
  revalidatePath('/classes/timetable')
}

export async function createClass(
  _prev: ClassFormState,
  formData: FormData
): Promise<ClassFormState> {
  const staff = await requireRole('owner', 'manager')
  const parsed = classSchema.safeParse(classValues(formData))
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  const d = parsed.data

  if (staff.role !== 'owner' && !staff.branchIds.includes(d.branchId)) {
    return { fieldErrors: { branchId: ['Pick one of your own branches.'] } }
  }

  const supabase = await createClient()
  const { data: created, error } = await supabase.from('classes').insert({
    org_id: staff.orgId,
    branch_id: d.branchId,
    name: d.name,
    description: d.description,
    trainer_id: d.trainerId,
    capacity: d.capacity,
    room: d.room,
    recurrence: d.recurrence,
    is_active: true,
  }).select('id').single()
  if (error) return { error: rpcErrorMessage(error, 'The class could not be saved.') }

  // Fill the calendar now rather than waiting for the nightly materializer.
  // The class is saved either way, so a failure here is not the user's problem.
  if (created) await supabase.rpc('generate_class_sessions', { p_class_id: created.id })

  revalidateClasses()
  return { success: `${d.name} was added.` }
}

export async function updateClass(
  _prev: ClassFormState,
  formData: FormData
): Promise<ClassFormState> {
  const staff = await requireRole('owner', 'manager')
  const parsed = updateClassSchema.safeParse({
    classId: formData.get('classId'),
    ...classValues(formData),
  })
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  const d = parsed.data

  if (staff.role !== 'owner' && !staff.branchIds.includes(d.branchId)) {
    return { fieldErrors: { branchId: ['Pick one of your own branches.'] } }
  }

  const supabase = await createClient()
  // branch_id is deliberately not updated: sessions already sit on the old one.
  const { data, error } = await supabase
    .from('classes')
    .update({
      name: d.name,
      description: d.description,
      trainer_id: d.trainerId,
      capacity: d.capacity,
      room: d.room,
      recurrence: d.recurrence,
      is_active: d.isActive,
    })
    .eq('id', d.classId)
    .select('id')
  if (error) return { error: rpcErrorMessage(error, 'The class could not be saved.') }
  if (!data?.length) return { error: 'That class could not be found, or is outside your branches.' }

  if (d.isActive) await supabase.rpc('generate_class_sessions', { p_class_id: d.classId })

  revalidateClasses()
  return { success: 'Class saved.' }
}

export async function rescheduleSession(input: {
  sessionId: string
  startsAt: string
  endsAt: string
}): Promise<{ error?: string }> {
  await requireRole('owner', 'manager')
  const parsed = rescheduleSchema.safeParse(input)
  if (!parsed.success) return { error: 'That time is not valid.' }

  const supabase = await createClient()
  // Generated types lag the migration that adds this RPC.
  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ error: unknown }>
  const { error } = await rpc.call(supabase, 'reschedule_class_session', {
    p_session_id: parsed.data.sessionId,
    p_starts_at: parsed.data.startsAt,
    p_ends_at: parsed.data.endsAt,
  })
  if (error) return { error: rpcErrorMessage(error, 'The session could not be moved.') }

  revalidatePath('/classes/timetable')
  return {}
}

export async function searchMembersForBooking(term: string) {
  await requireRole(...DESK)
  const parsed = z.string().trim().max(120).safeParse(term)
  if (!parsed.success || parsed.data.length < 2) return { members: [] }
  const rows = await searchMembersForCheckIn(parsed.data)
  return {
    members: rows.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      member_code: r.member_code,
      phone: r.phone,
    })),
  }
}

export async function loadSessionBookings(
  sessionId: string
): Promise<{ bookings: SessionBooking[]; error?: string }> {
  await requireRole(...DESK, 'trainer')
  const parsed = z.uuid().safeParse(sessionId)
  if (!parsed.success) return { bookings: [], error: 'Unknown session.' }
  try {
    return { bookings: await listSessionBookings(parsed.data) }
  } catch (error) {
    return { bookings: [], error: rpcErrorMessage(error, 'Bookings could not be loaded.') }
  }
}

export async function bookMember(input: {
  sessionId: string
  memberId: string
}): Promise<{ error?: string; status?: 'booked' | 'waitlisted' }> {
  await requireRole(...DESK)
  const parsed = bookSchema.safeParse(input)
  if (!parsed.success) return { error: 'Pick a member to book.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('book_class_session', {
    p_session_id: parsed.data.sessionId,
    p_member_id: parsed.data.memberId,
  })
  if (error) return { error: rpcErrorMessage(error, 'The booking could not be made.') }

  revalidatePath('/classes/timetable')
  const status = (data as { status?: string } | null)?.status
  return { status: status === 'waitlisted' ? 'waitlisted' : 'booked' }
}

export async function cancelBooking(input: {
  bookingId: string
  reason?: string
}): Promise<{ error?: string; promoted?: boolean }> {
  await requireRole(...DESK)
  const parsed = cancelBookingSchema.safeParse(input)
  if (!parsed.success) return { error: 'That booking could not be cancelled.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cancel_class_booking', {
    p_booking_id: parsed.data.bookingId,
    p_reason: parsed.data.reason || undefined,
  })
  if (error) return { error: rpcErrorMessage(error, 'The booking could not be cancelled.') }

  revalidatePath('/classes/timetable')
  return { promoted: Boolean((data as { promoted_booking_id?: string } | null)?.promoted_booking_id) }
}
