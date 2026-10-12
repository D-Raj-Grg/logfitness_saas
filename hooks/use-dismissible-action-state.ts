'use client'

import { useActionState, useState } from 'react'

/**
 * useActionState for forms that live in a dialog. React gives no way to clear
 * an action's result, so a failed attempt's error -- or a one-time device key --
 * would still be on screen when the dialog is opened again. `dismiss()` hides
 * whatever result is current; the next submission brings a fresh one.
 */
export function useDismissibleActionState<State extends object>(
  action: (state: State, formData: FormData) => Promise<State>,
  initialState: State
) {
  // State is a plain result object, never a thenable, so Awaited<State> is
  // State; the casts only spell that out for the generic.
  const [state, formAction, pending] = useActionState<State, FormData>(
    action as (state: Awaited<State>, formData: FormData) => Promise<State>,
    initialState as Awaited<State>
  )
  const [dismissed, setDismissed] = useState<State | null>(null)

  const visible = state === dismissed ? initialState : state
  const dismiss = () => setDismissed(state)

  return [visible, formAction, pending, dismiss] as const
}
