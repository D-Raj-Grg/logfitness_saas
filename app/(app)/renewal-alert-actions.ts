'use server'

import { z } from 'zod'

import { getCurrentStaff } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

const memberIdSchema = z.uuid()

/**
 * The name for a live "asked to renew" toast. The realtime payload carries a
 * member id only. This reads member_overview as the caller, so RLS keeps it to
 * members the caller may see; a member outside that returns null and the
 * client simply shows no toast.
 */
export async function renewalAlertMemberName(
  memberId: string
): Promise<{ name: string } | null> {
  const parsed = memberIdSchema.safeParse(memberId)
  if (!parsed.success) return null

  const staff = await getCurrentStaff()
  if (!staff || staff.role === 'trainer') return null

  const supabase = await createClient()
  const { data } = await supabase
    .from('member_overview')
    .select('full_name')
    .eq('id', parsed.data)
    .maybeSingle()

  return data?.full_name ? { name: data.full_name } : null
}
