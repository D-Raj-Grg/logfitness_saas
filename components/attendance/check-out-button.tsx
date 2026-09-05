'use client'

import { useActionState } from 'react'

import { checkOut, type CheckOutActionState } from '@/app/(app)/check-in/actions'
import { Button } from '@/components/ui/button'

/**
 * One row's check-out. Its own action state so a failure names the row it
 * belongs to instead of taking over the whole roster.
 */
export function CheckOutButton({ attendanceId }: { attendanceId: string }) {
  const [state, formAction, pending] = useActionState<CheckOutActionState, FormData>(
    checkOut,
    {}
  )

  return (
    <form action={formAction} className="shrink-0 text-right">
      <input type="hidden" name="attendanceId" value={attendanceId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? 'Saving...' : 'Check out'}
      </Button>
      {state.error ? <p className="mt-1 text-xs text-destructive">{state.error}</p> : null}
    </form>
  )
}
